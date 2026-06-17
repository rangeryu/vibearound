use std::collections::BTreeMap;

use common::config::{SearchSourceConfig, SearchToolConfig};
use common::search::{SearchToolRuntime, WebSearchRequest, WebSearchResponse};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestWebSearchRequest {
    pub query: String,
    pub max_results: Option<usize>,
    pub search_context_size: Option<String>,
    pub sources: BTreeMap<String, TestSearchSource>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestSearchSource {
    pub enabled: bool,
    pub api_key: Option<String>,
}

#[tauri::command]
pub async fn test_web_search(request: TestWebSearchRequest) -> Result<WebSearchResponse, String> {
    let query = request.query.trim();
    if query.is_empty() {
        return Err("Search query is required.".to_string());
    }

    let config = test_search_config(&request);
    let Some(runtime) = SearchToolRuntime::spawn_if_enabled(&config)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Err("Search runtime is unavailable. Install the search plugin and enable at least one source.".to_string());
    };

    let result = runtime
        .search(WebSearchRequest {
            query: query.to_string(),
            max_results: config.max_results,
            include_domains: Vec::new(),
            exclude_domains: Vec::new(),
            search_context_size: config.search_context_size.clone(),
            providers: config.enabled_source_names(),
        })
        .await
        .map_err(|error| error.to_string());
    runtime.shutdown().await;
    result
}

fn test_search_config(request: &TestWebSearchRequest) -> SearchToolConfig {
    let current = common::config::ensure_loaded();
    let mut sources = BTreeMap::new();

    for (name, source) in &request.sources {
        let existing = current.search_tool.sources.get(name);
        let api_key = source
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .or_else(|| existing.and_then(|source| source.api_key.clone()));
        sources.insert(
            name.clone(),
            SearchSourceConfig {
                enabled: source.enabled,
                api_key,
                api_key_env: existing.and_then(|source| source.api_key_env.clone()),
                base_url: existing.and_then(|source| source.base_url.clone()),
            },
        );
    }

    SearchToolConfig {
        stdio_path: current.search_tool.stdio_path.clone(),
        max_results: request.max_results.or(current.search_tool.max_results),
        search_context_size: request
            .search_context_size
            .clone()
            .or_else(|| current.search_tool.search_context_size.clone()),
        sources,
    }
}
