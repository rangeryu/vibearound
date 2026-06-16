use async_trait::async_trait;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use va_ai_api_bridge::{
    ContentBlock, ServerToolDeclaration, ServerToolKind, ToolChoice, UniversalItem,
    UniversalRequest, UniversalResponse, UniversalTool,
};

pub(super) const WEB_SEARCH_FALLBACK_TOOL_NAME: &str = "vibearound_web_search";
pub(super) const MAX_WEB_SEARCH_FALLBACK_ROUNDS: usize = 4;

#[derive(Debug, Clone)]
pub(super) struct WebSearchFallback {
    pub(super) original_stream: bool,
    default_request: WebSearchRequest,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(super) struct WebSearchRequest {
    pub query: String,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub include_domains: Vec<String>,
    #[serde(default)]
    pub exclude_domains: Vec<String>,
    #[serde(default)]
    pub search_context_size: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct WebSearchResponse {
    pub provider: String,
    pub query: String,
    pub results: Vec<WebSearchResult>,
    pub citations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub content: String,
    pub score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_date: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WebSearchError {
    message: String,
}

impl WebSearchError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for WebSearchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

#[async_trait]
pub(super) trait WebSearchProvider {
    async fn search(&self, request: WebSearchRequest) -> Result<WebSearchResponse, WebSearchError>;
}

#[derive(Debug, Clone, Default)]
pub(super) struct MockWebSearchProvider;

#[async_trait]
impl WebSearchProvider for MockWebSearchProvider {
    async fn search(&self, request: WebSearchRequest) -> Result<WebSearchResponse, WebSearchError> {
        let query = request.query.trim();
        if query.is_empty() {
            return Err(WebSearchError::new("web search query must not be empty"));
        }

        let max_results = request.max_results.unwrap_or(3).clamp(1, 5);
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
                        "Mock web search snippet for '{query}'. Replace MockWebSearchProvider with Exa, Tavily, Brave, or Grok to fetch live results."
                    ),
                    content: format!(
                        "This deterministic mock result stands in for a live web result about '{query}'. It carries the same normalized fields real providers expose: title, url, snippet/content, score, published_date, and source."
                    ),
                    score: 1.0 - (index as f64 * 0.08),
                    published_date: Some(today.clone()),
                    source: "mock".to_string(),
                }
            })
            .collect::<Vec<_>>();
        let citations = results.iter().map(|result| result.url.clone()).collect();

        Ok(WebSearchResponse {
            provider: "mock".to_string(),
            query: query.to_string(),
            results,
            citations,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
struct HostToolCall {
    id: String,
    arguments: Value,
}

pub(super) fn request_needs_web_search_fallback(request: &UniversalRequest) -> bool {
    request
        .server_tools
        .iter()
        .any(|tool| is_web_search_kind(tool.kind))
}

pub(super) fn prepare_web_search_fallback(
    request: &mut UniversalRequest,
) -> Option<WebSearchFallback> {
    let declaration = request
        .server_tools
        .iter()
        .find(|tool| is_web_search_kind(tool.kind))?;
    let original_stream = request.stream;
    let default_request = request_defaults_from_declaration(declaration);

    if !request
        .tools
        .iter()
        .any(|tool| tool.name == WEB_SEARCH_FALLBACK_TOOL_NAME)
    {
        request.tools.push(web_search_fallback_tool());
    }

    if matches!(
        request.tool_choice,
        Some(ToolChoice::ServerTool {
            kind: ServerToolKind::WebSearch | ServerToolKind::XSearch
        })
    ) {
        request.tool_choice = Some(ToolChoice::Tool {
            name: WEB_SEARCH_FALLBACK_TOOL_NAME.to_string(),
        });
    }

    request.stream = false;

    Some(WebSearchFallback {
        original_stream,
        default_request,
    })
}

pub(super) async fn append_web_search_results(
    request: &mut UniversalRequest,
    response: UniversalResponse,
    fallback: &WebSearchFallback,
    provider: &impl WebSearchProvider,
) -> Result<bool, String> {
    let (calls, has_other_tool_calls) = collect_host_tool_calls(&response);
    if calls.is_empty() {
        return Ok(false);
    }
    if has_other_tool_calls {
        return Err(
            "web search fallback cannot be mixed with client tool calls in the same model turn"
                .to_string(),
        );
    }

    request.input.extend(response.output);
    for call in calls {
        let search_request = search_request_from_tool_arguments(&fallback.default_request, &call);
        let (content, is_error) = match provider.search(search_request).await {
            Ok(response) => (
                serde_json::to_string_pretty(&response)
                    .unwrap_or_else(|_| json!(response).to_string()),
                false,
            ),
            Err(error) => (
                json!({
                    "provider": "mock",
                    "error": error.to_string()
                })
                .to_string(),
                true,
            ),
        };
        request.input.push(UniversalItem::ToolResult {
            tool_call_id: call.id,
            content: vec![ContentBlock::Text { text: content }],
            is_error,
            extensions: Default::default(),
        });
    }
    request.tool_choice = Some(ToolChoice::Auto);
    Ok(true)
}

fn collect_host_tool_calls(response: &UniversalResponse) -> (Vec<HostToolCall>, bool) {
    let mut calls = Vec::new();
    let mut has_other_tool_calls = false;
    for item in &response.output {
        match item {
            UniversalItem::ToolCall {
                id,
                name,
                arguments,
                ..
            } if name == WEB_SEARCH_FALLBACK_TOOL_NAME => calls.push(HostToolCall {
                id: id.clone(),
                arguments: arguments.clone(),
            }),
            UniversalItem::ToolCall { .. } => has_other_tool_calls = true,
            UniversalItem::Message { content, .. } => {
                for block in content {
                    match block {
                        ContentBlock::ToolCall {
                            id,
                            name,
                            arguments,
                            ..
                        } if name == WEB_SEARCH_FALLBACK_TOOL_NAME => calls.push(HostToolCall {
                            id: id.clone(),
                            arguments: arguments.clone(),
                        }),
                        ContentBlock::ToolCall { .. } => has_other_tool_calls = true,
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    (calls, has_other_tool_calls)
}

fn request_defaults_from_declaration(declaration: &ServerToolDeclaration) -> WebSearchRequest {
    let config = declaration.config.as_object();
    let include_domains = string_array_field(&declaration.config, "include_domains")
        .or_else(|| string_array_field(&declaration.config, "allowed_domains"))
        .unwrap_or_default();
    let exclude_domains =
        string_array_field(&declaration.config, "exclude_domains").unwrap_or_default();
    let max_results = config
        .and_then(|config| {
            config
                .get("max_results")
                .or_else(|| config.get("maxResults"))
                .or_else(|| config.get("num_results"))
        })
        .and_then(Value::as_u64)
        .map(|value| value as usize);
    let search_context_size = config
        .and_then(|config| {
            config
                .get("search_context_size")
                .or_else(|| config.get("searchContextSize"))
        })
        .and_then(Value::as_str)
        .map(ToString::to_string);

    WebSearchRequest {
        query: String::new(),
        max_results,
        include_domains,
        exclude_domains,
        search_context_size,
    }
}

fn search_request_from_tool_arguments(
    defaults: &WebSearchRequest,
    call: &HostToolCall,
) -> WebSearchRequest {
    let mut request = defaults.clone();
    let object = call.arguments.as_object();
    if let Some(query) = object
        .and_then(|object| object.get("query"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|query| !query.is_empty())
    {
        request.query = query.to_string();
    }
    if let Some(max_results) = object
        .and_then(|object| {
            object
                .get("max_results")
                .or_else(|| object.get("maxResults"))
                .or_else(|| object.get("num_results"))
        })
        .and_then(Value::as_u64)
    {
        request.max_results = Some(max_results as usize);
    }
    if let Some(include_domains) = string_array_field(&call.arguments, "include_domains")
        .or_else(|| string_array_field(&call.arguments, "allowed_domains"))
    {
        request.include_domains = include_domains;
    }
    if let Some(exclude_domains) = string_array_field(&call.arguments, "exclude_domains") {
        request.exclude_domains = exclude_domains;
    }
    if let Some(search_context_size) = object
        .and_then(|object| {
            object
                .get("search_context_size")
                .or_else(|| object.get("searchContextSize"))
        })
        .and_then(Value::as_str)
    {
        request.search_context_size = Some(search_context_size.to_string());
    }
    request
}

fn string_array_field(value: &Value, key: &str) -> Option<Vec<String>> {
    let values = value.as_object()?.get(key)?.as_array()?;
    Some(
        values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .collect(),
    )
}

fn web_search_fallback_tool() -> UniversalTool {
    UniversalTool {
        name: WEB_SEARCH_FALLBACK_TOOL_NAME.to_string(),
        description: Some(
            "Search the web through the VibeAround host when the upstream model provider does not support native server-side web search."
                .to_string(),
        ),
        input_schema: Some(json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The web search query."
                },
                "max_results": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10,
                    "description": "Maximum number of normalized search results to return."
                },
                "include_domains": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional domains to prefer or restrict to."
                },
                "exclude_domains": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional domains to exclude."
                },
                "search_context_size": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "Provider-style context size hint."
                }
            },
            "required": ["query"],
            "additionalProperties": false
        })),
        strict: Some(false),
        extensions: Default::default(),
    }
}

fn is_web_search_kind(kind: ServerToolKind) -> bool {
    matches!(kind, ServerToolKind::WebSearch | ServerToolKind::XSearch)
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
    use serde_json::json;
    use va_ai_api_bridge::{ServerToolDeclaration, WireProtocol};

    use super::*;

    #[test]
    fn injects_fallback_tool_for_server_web_search() {
        let mut request = UniversalRequest {
            server_tools: vec![ServerToolDeclaration {
                kind: ServerToolKind::WebSearch,
                wire_type: "web_search".to_string(),
                source_protocol: WireProtocol::OpenAiResponses,
                name: None,
                config: json!({
                    "search_context_size": "low",
                    "allowed_domains": ["example.com"]
                }),
                raw: json!({"type": "web_search"}),
                extensions: Default::default(),
            }],
            tool_choice: Some(ToolChoice::ServerTool {
                kind: ServerToolKind::WebSearch,
            }),
            stream: true,
            ..UniversalRequest::default()
        };

        let fallback = prepare_web_search_fallback(&mut request).expect("fallback");

        assert!(fallback.original_stream);
        assert!(!request.stream);
        assert!(request
            .tools
            .iter()
            .any(|tool| tool.name == WEB_SEARCH_FALLBACK_TOOL_NAME));
        assert_eq!(
            request.tool_choice,
            Some(ToolChoice::Tool {
                name: WEB_SEARCH_FALLBACK_TOOL_NAME.to_string()
            })
        );
        assert_eq!(
            fallback.default_request.include_domains,
            vec!["example.com".to_string()]
        );
    }

    #[tokio::test]
    async fn mock_provider_returns_normalized_results() {
        let provider = MockWebSearchProvider;
        let response = provider
            .search(WebSearchRequest {
                query: "server web search".to_string(),
                max_results: Some(2),
                ..WebSearchRequest::default()
            })
            .await
            .expect("mock search");

        assert_eq!(response.provider, "mock");
        assert_eq!(response.results.len(), 2);
        assert!(response.results[0].url.contains("server-web-search"));
        assert_eq!(response.citations.len(), 2);
    }

    #[tokio::test]
    async fn appends_tool_results_for_host_search_calls() {
        let fallback = WebSearchFallback {
            original_stream: false,
            default_request: WebSearchRequest::default(),
        };
        let mut request = UniversalRequest::default();
        let response = UniversalResponse {
            output: vec![UniversalItem::ToolCall {
                id: "call_search".to_string(),
                name: WEB_SEARCH_FALLBACK_TOOL_NAME.to_string(),
                arguments: json!({ "query": "vaaab web search" }),
                extensions: Default::default(),
            }],
            ..UniversalResponse::default()
        };

        let appended =
            append_web_search_results(&mut request, response, &fallback, &MockWebSearchProvider)
                .await
                .expect("append results");

        assert!(appended);
        assert_eq!(request.input.len(), 2);
        assert!(matches!(
            request.input.last(),
            Some(UniversalItem::ToolResult {
                is_error: false,
                ..
            })
        ));
    }
}
