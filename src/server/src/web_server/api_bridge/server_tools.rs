use std::sync::Arc;

use async_trait::async_trait;
use common::search::{SearchError, SearchToolRuntime, WebSearchRequest, WebSearchResponse};
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

#[async_trait]
pub(super) trait WebSearchProvider {
    async fn search(&self, request: WebSearchRequest) -> Result<WebSearchResponse, SearchError>;
}

#[derive(Clone, Default)]
pub(super) struct HostWebSearchProvider {
    runtime: Option<Arc<SearchToolRuntime>>,
}

impl HostWebSearchProvider {
    pub(super) fn new(runtime: Option<Arc<SearchToolRuntime>>) -> Self {
        Self { runtime }
    }
}

#[async_trait]
impl WebSearchProvider for HostWebSearchProvider {
    async fn search(&self, request: WebSearchRequest) -> Result<WebSearchResponse, SearchError> {
        let runtime = self
            .runtime
            .as_ref()
            .ok_or_else(|| SearchError::new("search provider runtime is not running"))?;
        runtime.search(request).await.map_err(|error| {
            tracing::warn!(
                target: "server::web_server::api_bridge",
                error = %error,
                "supervised va-search-tool failed"
            );
            error
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
                    "provider": "vibearound",
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
        providers: Vec::new(),
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
                    "maximum": 20,
                    "description": "Maximum number of normalized search results to return per enabled source."
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

        let appended = append_web_search_results(&mut request, response, &fallback, &TestProvider)
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

    struct TestProvider;

    #[async_trait]
    impl WebSearchProvider for TestProvider {
        async fn search(
            &self,
            request: WebSearchRequest,
        ) -> Result<WebSearchResponse, SearchError> {
            Ok(WebSearchResponse {
                provider: "test".to_string(),
                query: request.query,
                results: Vec::new(),
                citations: Vec::new(),
            })
        }
    }
}
