use std::collections::HashMap;
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::anyhow;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;

use crate::process::bridge::{
    BridgeExit, BridgeFactory, BridgeFuture, CancelSignal, ProcessBridge,
};
use crate::process::registry::ProcessKind;
use crate::process::supervisor::{ProcessId, RestartPolicy, SpawnSpec, Supervisor};
use crate::process::StdioPipes;

const SEARCH_TOOL_ENV: &str = "VA_SEARCH_TOOL_STDIO";
const SEARCH_TOOL_LABEL: &str = "va-search-tool";
const SEARCH_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const SEARCH_READY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchRequest {
    pub query: String,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub include_domains: Vec<String>,
    #[serde(default)]
    pub exclude_domains: Vec<String>,
    #[serde(default)]
    pub search_context_size: Option<String>,
    #[serde(default)]
    pub providers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResponse {
    pub provider: String,
    pub query: String,
    pub results: Vec<WebSearchResult>,
    pub citations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub content: String,
    pub score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_date: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchError {
    pub message: String,
}

impl SearchError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for SearchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SearchError {}

#[derive(Debug, Clone, Default)]
pub struct MockSearchProvider;

impl MockSearchProvider {
    pub async fn search(
        &self,
        request: WebSearchRequest,
    ) -> Result<WebSearchResponse, SearchError> {
        let query = request.query.trim();
        if query.is_empty() {
            return Err(SearchError::new("web search query must not be empty"));
        }

        let max_results = request.max_results.unwrap_or(3).clamp(1, 10);
        let provider = request
            .providers
            .iter()
            .map(|provider| provider.trim())
            .find(|provider| !provider.is_empty())
            .unwrap_or("mock")
            .to_string();
        let today = Utc::now().date_naive().to_string();
        let mut domains = if request.include_domains.is_empty() {
            vec!["example.com".to_string(), "docs.example.com".to_string()]
        } else {
            request.include_domains.clone()
        };
        if !request.exclude_domains.is_empty() {
            domains.retain(|domain| {
                !request
                    .exclude_domains
                    .iter()
                    .any(|exclude| exclude == domain)
            });
        }
        if domains.is_empty() {
            domains.push("example.com".to_string());
        }

        let slug = slugify(query);
        let results = (0..max_results)
            .map(|index| {
                let domain = domains
                    .get(index % domains.len())
                    .map(String::as_str)
                    .unwrap_or("example.com");
                let url = format!("https://{domain}/mock-search/{slug}-{index}");
                WebSearchResult {
                    title: format!("Mock search result {} for {query}", index + 1),
                    url: url.clone(),
                    snippet: format!(
                        "Mock web search snippet for '{query}'. Replace the mock provider with Exa, Tavily, Brave, or Grok to fetch live results."
                    ),
                    content: format!(
                        "This deterministic mock result stands in for a live web result about '{query}'. It carries the normalized fields real providers expose: title, url, snippet/content, score, published_date, and source."
                    ),
                    score: 1.0 - (index as f64 * 0.08),
                    published_date: Some(today.clone()),
                    source: provider.clone(),
                }
            })
            .collect::<Vec<_>>();
        let citations = results.iter().map(|result| result.url.clone()).collect();

        Ok(WebSearchResponse {
            provider,
            query: query.to_string(),
            results,
            citations,
        })
    }
}

#[derive(Clone)]
pub struct SearchToolRuntime {
    process_id: ProcessId,
    requests: mpsc::Sender<SearchCommand>,
}

impl SearchToolRuntime {
    pub async fn spawn_if_available() -> anyhow::Result<Option<Arc<Self>>> {
        let Some(executable) = search_tool_executable() else {
            tracing::info!("va-search-tool executable not found; using built-in mock search");
            return Ok(None);
        };

        let (request_tx, request_rx) = mpsc::channel::<SearchCommand>(64);
        let (ready_tx, ready_rx) = oneshot::channel::<()>();
        let bridge = SearchToolBridge {
            request_rx,
            ready_tx: Some(ready_tx),
        };
        let slot: Arc<parking_lot::Mutex<Option<SearchToolBridge>>> =
            Arc::new(parking_lot::Mutex::new(Some(bridge)));
        let factory: BridgeFactory = Box::new(move || {
            let bridge = slot.lock().take().expect(
                "SearchToolBridge factory called more than once; RestartPolicy::Never is used",
            );
            Box::new(bridge) as Box<dyn ProcessBridge>
        });

        let spec = SpawnSpec::new(executable.to_string_lossy().to_string()).arg("stdio");
        let supervisor = Supervisor::global();
        let process_id = supervisor.register(
            ProcessKind::SearchProvider,
            SEARCH_TOOL_LABEL,
            spec,
            RestartPolicy::Never,
            factory,
        );

        match timeout(SEARCH_READY_TIMEOUT, ready_rx).await {
            Ok(Ok(())) => {
                tracing::info!(process_id = %process_id, "va-search-tool runtime ready");
            }
            Ok(Err(_)) | Err(_) => {
                let _ = supervisor.force_stop(process_id).await;
                tracing::warn!("va-search-tool did not become ready; using built-in mock search");
                return Ok(None);
            }
        }

        Ok(Some(Arc::new(Self {
            process_id,
            requests: request_tx,
        })))
    }

    pub async fn search(
        &self,
        request: WebSearchRequest,
    ) -> Result<WebSearchResponse, SearchError> {
        let (tx, rx) = oneshot::channel();
        self.requests
            .send(SearchCommand { request, tx })
            .await
            .map_err(|_| SearchError::new("search provider runtime is not running"))?;
        timeout(SEARCH_REQUEST_TIMEOUT, rx)
            .await
            .map_err(|_| SearchError::new("search provider request timed out"))?
            .map_err(|_| SearchError::new("search provider dropped the response"))?
    }

    pub async fn shutdown(&self) {
        if let Err(error) = Supervisor::global().force_stop(self.process_id).await {
            tracing::warn!(error = %error, "failed to stop va-search-tool runtime");
        }
    }
}

struct SearchCommand {
    request: WebSearchRequest,
    tx: oneshot::Sender<Result<WebSearchResponse, SearchError>>,
}

struct SearchToolBridge {
    request_rx: mpsc::Receiver<SearchCommand>,
    ready_tx: Option<oneshot::Sender<()>>,
}

impl ProcessBridge for SearchToolBridge {
    fn run(self: Box<Self>, pipes: StdioPipes, cancel: CancelSignal) -> BridgeFuture {
        Box::pin(async move { self.drive(pipes, cancel).await })
    }
}

impl SearchToolBridge {
    async fn drive(mut self: Box<Self>, pipes: StdioPipes, mut cancel: CancelSignal) -> BridgeExit {
        let mut stdin = pipes.stdin;
        let mut stdout = BufReader::new(pipes.stdout).lines();
        let mut pending: HashMap<String, oneshot::Sender<Result<WebSearchResponse, SearchError>>> =
            HashMap::new();
        let mut next_id = 1_u64;

        if let Some(ready_tx) = self.ready_tx.take() {
            let _ = ready_tx.send(());
        }

        loop {
            tokio::select! {
                changed = cancel.changed() => {
                    if changed.is_err() || *cancel.borrow() {
                        fail_pending(&mut pending, "search provider runtime stopped");
                        return BridgeExit::Cancelled;
                    }
                }
                command = self.request_rx.recv() => {
                    let Some(command) = command else {
                        fail_pending(&mut pending, "search provider request channel closed");
                        return BridgeExit::Clean;
                    };
                    let id = format!("search_{next_id}");
                    next_id = next_id.wrapping_add(1);
                    let payload = SearchToolRpcRequest {
                        id: id.clone(),
                        method: "web_search".to_string(),
                        params: command.request,
                    };
                    let mut line = match serde_json::to_vec(&payload) {
                        Ok(line) => line,
                        Err(error) => {
                            let _ = command.tx.send(Err(SearchError::new(format!(
                                "failed to encode search request: {error}"
                            ))));
                            continue;
                        }
                    };
                    line.push(b'\n');
                    if let Err(error) = stdin.write_all(&line).await {
                        let _ = command.tx.send(Err(SearchError::new(format!(
                            "failed to write search request: {error}"
                        ))));
                        fail_pending(&mut pending, "search provider stdin closed");
                        return BridgeExit::ProtocolError(anyhow!(error).context("search provider stdin closed"));
                    }
                    pending.insert(id, command.tx);
                }
                line = stdout.next_line() => {
                    match line {
                        Ok(Some(line)) => handle_search_response_line(&line, &mut pending),
                        Ok(None) => {
                            fail_pending(&mut pending, "search provider stdout closed");
                            return BridgeExit::Clean;
                        }
                        Err(error) => {
                            fail_pending(&mut pending, "failed to read search provider stdout");
                            return BridgeExit::ProtocolError(anyhow!(error).context("failed to read search provider stdout"));
                        }
                    }
                }
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchToolRpcRequest {
    id: String,
    method: String,
    params: WebSearchRequest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchToolRpcResponse {
    id: Option<String>,
    result: Option<WebSearchResponse>,
    error: Option<SearchToolRpcError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchToolRpcError {
    message: String,
}

fn handle_search_response_line(
    line: &str,
    pending: &mut HashMap<String, oneshot::Sender<Result<WebSearchResponse, SearchError>>>,
) {
    let response = match serde_json::from_str::<SearchToolRpcResponse>(line) {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(error = %error, "failed to decode search provider response");
            return;
        }
    };
    let Some(id) = response.id else {
        tracing::warn!("search provider response missing id");
        return;
    };
    let Some(tx) = pending.remove(&id) else {
        tracing::warn!(%id, "search provider response had no pending request");
        return;
    };
    let result = match (response.result, response.error) {
        (Some(result), None) => Ok(result),
        (_, Some(error)) => Err(SearchError::new(error.message)),
        (None, None) => Err(SearchError::new("search provider response missing result")),
    };
    let _ = tx.send(result);
}

fn fail_pending(
    pending: &mut HashMap<String, oneshot::Sender<Result<WebSearchResponse, SearchError>>>,
    message: &str,
) {
    for (_, tx) in pending.drain() {
        let _ = tx.send(Err(SearchError::new(message)));
    }
}

fn search_tool_executable() -> Option<PathBuf> {
    env::var_os(SEARCH_TOOL_ENV)
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .or_else(dev_search_tool_executable)
}

fn dev_search_tool_executable() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    [
        manifest_dir.join("../../../va-search-tool/target/debug/va-search-tool"),
        manifest_dir.join("../../../va-search-tool/target/release/va-search-tool"),
    ]
    .into_iter()
    .find(|path| path.exists())
}

fn slugify(value: &str) -> String {
    let slug = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "query".to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_search_returns_normalized_results() {
        let response = MockSearchProvider
            .search(WebSearchRequest {
                query: "server web search".to_string(),
                max_results: Some(2),
                providers: vec!["mock".to_string()],
                ..WebSearchRequest::default()
            })
            .await
            .expect("mock search");

        assert_eq!(response.provider, "mock");
        assert_eq!(response.results.len(), 2);
        assert!(response.results[0].url.contains("server-web-search"));
        assert_eq!(response.citations.len(), 2);
    }
}
