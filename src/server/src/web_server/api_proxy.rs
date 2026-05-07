use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use va_ai_api_proxy::{
    AnthropicMessagesTranslator, DecodeState, EncodeState, OpenAiChatTranslator,
    OpenAiResponsesTranslator, UniversalEvent, WireEvent, WireTranslator,
};

use common::agent_state;
use common::profiles::{catalog, schema::ProfileDef};

mod completion;
mod stream;
mod upstream;

use crate::openai_proxy::providers::{ProviderProxyAdapter, ProviderProxyContext};

use completion::translated_completion_response;
use stream::translated_stream_response;
use upstream::{
    apply_upstream_auth, normalize_target_request, redacted_url, upstream_endpoint,
    upstream_error_response,
};

use super::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProxyProtocol {
    OpenAiResponses,
    OpenAiChat,
    AnthropicMessages,
}

impl ProxyProtocol {
    fn from_api_type(api_type: &str) -> Option<Self> {
        match api_type {
            "openai-responses" => Some(Self::OpenAiResponses),
            "openai-chat" => Some(Self::OpenAiChat),
            "anthropic" => Some(Self::AnthropicMessages),
            _ => None,
        }
    }

    fn decode_agent_request(
        self,
        raw: Value,
    ) -> va_ai_api_proxy::Result<va_ai_api_proxy::UniversalRequest> {
        match self {
            Self::OpenAiResponses => OpenAiResponsesTranslator.decode_request(raw),
            Self::OpenAiChat => OpenAiChatTranslator.decode_request(raw),
            Self::AnthropicMessages => AnthropicMessagesTranslator.decode_request(raw),
        }
    }

    fn encode_upstream_request(
        self,
        request: &va_ai_api_proxy::UniversalRequest,
    ) -> va_ai_api_proxy::Result<Value> {
        match self {
            Self::OpenAiResponses => OpenAiResponsesTranslator.encode_request(request),
            Self::OpenAiChat => OpenAiChatTranslator.encode_request(request),
            Self::AnthropicMessages => AnthropicMessagesTranslator.encode_request(request),
        }
    }

    fn decode_upstream_response(self, raw: Value) -> va_ai_api_proxy::Result<Vec<UniversalEvent>> {
        match self {
            Self::OpenAiResponses => OpenAiResponsesTranslator.decode_response(raw),
            Self::OpenAiChat => OpenAiChatTranslator.decode_response(raw),
            Self::AnthropicMessages => AnthropicMessagesTranslator.decode_response(raw),
        }
    }

    fn decode_upstream_stream_chunk(
        self,
        raw: Value,
        state: &mut DecodeState,
    ) -> va_ai_api_proxy::Result<Vec<UniversalEvent>> {
        match self {
            Self::OpenAiResponses => OpenAiResponsesTranslator.decode_stream_chunk(raw, state),
            Self::OpenAiChat => OpenAiChatTranslator.decode_stream_chunk(raw, state),
            Self::AnthropicMessages => AnthropicMessagesTranslator.decode_stream_chunk(raw, state),
        }
    }

    fn encode_agent_events(
        self,
        events: &[UniversalEvent],
        state: &mut EncodeState,
    ) -> va_ai_api_proxy::Result<Vec<WireEvent>> {
        match self {
            Self::OpenAiResponses => OpenAiResponsesTranslator.encode_events(events, state),
            Self::OpenAiChat => OpenAiChatTranslator.encode_events(events, state),
            Self::AnthropicMessages => AnthropicMessagesTranslator.encode_events(events, state),
        }
    }

    fn is_openai_family(self) -> bool {
        matches!(self, Self::OpenAiResponses | Self::OpenAiChat)
    }

    fn api_type(self) -> &'static str {
        match self {
            Self::OpenAiResponses => "openai-responses",
            Self::OpenAiChat => "openai-chat",
            Self::AnthropicMessages => "anthropic",
        }
    }
}

pub async fn responses_handler(
    State(state): State<AppState>,
    Path((profile_id, launch_id, target_api_type)): Path<(String, String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    proxy_handler(
        state,
        profile_id,
        Some(launch_id),
        None,
        None,
        target_api_type,
        ProxyProtocol::OpenAiResponses,
        headers,
        original_request,
    )
    .await
}

pub async fn scoped_responses_handler(
    State(state): State<AppState>,
    Path((profile_id, launch_id, scope, target_api_type)): Path<(String, String, String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    proxy_handler(
        state,
        profile_id,
        Some(launch_id),
        Some(scope),
        None,
        target_api_type,
        ProxyProtocol::OpenAiResponses,
        headers,
        original_request,
    )
    .await
}

pub async fn legacy_responses_handler(
    State(state): State<AppState>,
    Path((profile_id, target_api_type)): Path<(String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    proxy_handler(
        state,
        profile_id,
        None,
        None,
        None,
        target_api_type,
        ProxyProtocol::OpenAiResponses,
        headers,
        original_request,
    )
    .await
}

pub async fn local_responses_handler(
    State(state): State<AppState>,
    Path((profile_id, scope, target_api_type)): Path<(String, String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    let route_scope = scope.clone();
    proxy_handler(
        state,
        profile_id,
        None,
        Some(route_scope),
        Some(scope),
        target_api_type,
        ProxyProtocol::OpenAiResponses,
        headers,
        original_request,
    )
    .await
}

pub async fn chat_completions_handler(
    State(state): State<AppState>,
    Path((profile_id, launch_id, target_api_type)): Path<(String, String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    proxy_handler(
        state,
        profile_id,
        Some(launch_id),
        None,
        None,
        target_api_type,
        ProxyProtocol::OpenAiChat,
        headers,
        original_request,
    )
    .await
}

pub async fn scoped_chat_completions_handler(
    State(state): State<AppState>,
    Path((profile_id, launch_id, scope, target_api_type)): Path<(String, String, String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    proxy_handler(
        state,
        profile_id,
        Some(launch_id),
        Some(scope),
        None,
        target_api_type,
        ProxyProtocol::OpenAiChat,
        headers,
        original_request,
    )
    .await
}

pub async fn legacy_chat_completions_handler(
    State(state): State<AppState>,
    Path((profile_id, target_api_type)): Path<(String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    proxy_handler(
        state,
        profile_id,
        None,
        None,
        None,
        target_api_type,
        ProxyProtocol::OpenAiChat,
        headers,
        original_request,
    )
    .await
}

pub async fn local_chat_completions_handler(
    State(state): State<AppState>,
    Path((profile_id, scope, target_api_type)): Path<(String, String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    let route_scope = scope.clone();
    proxy_handler(
        state,
        profile_id,
        None,
        Some(route_scope),
        Some(scope),
        target_api_type,
        ProxyProtocol::OpenAiChat,
        headers,
        original_request,
    )
    .await
}

pub async fn messages_handler(
    State(state): State<AppState>,
    Path((profile_id, launch_id, target_api_type)): Path<(String, String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    proxy_handler(
        state,
        profile_id,
        Some(launch_id),
        None,
        None,
        target_api_type,
        ProxyProtocol::AnthropicMessages,
        headers,
        original_request,
    )
    .await
}

pub async fn scoped_messages_handler(
    State(state): State<AppState>,
    Path((profile_id, launch_id, scope, target_api_type)): Path<(String, String, String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    proxy_handler(
        state,
        profile_id,
        Some(launch_id),
        Some(scope),
        None,
        target_api_type,
        ProxyProtocol::AnthropicMessages,
        headers,
        original_request,
    )
    .await
}

pub async fn legacy_messages_handler(
    State(state): State<AppState>,
    Path((profile_id, target_api_type)): Path<(String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    proxy_handler(
        state,
        profile_id,
        None,
        None,
        None,
        target_api_type,
        ProxyProtocol::AnthropicMessages,
        headers,
        original_request,
    )
    .await
}

pub async fn local_messages_handler(
    State(state): State<AppState>,
    Path((profile_id, scope, target_api_type)): Path<(String, String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    let route_scope = scope.clone();
    proxy_handler(
        state,
        profile_id,
        None,
        Some(route_scope),
        Some(scope),
        target_api_type,
        ProxyProtocol::AnthropicMessages,
        headers,
        original_request,
    )
    .await
}

async fn proxy_handler(
    state: AppState,
    profile_id: String,
    launch_id: Option<String>,
    route_scope: Option<String>,
    manual_scope: Option<String>,
    target_api_type: String,
    client_protocol: ProxyProtocol,
    headers: HeaderMap,
    original_request: Value,
) -> Response {
    let upstream = match upstream_endpoint(&profile_id, &target_api_type) {
        Ok(endpoint) => endpoint,
        Err((status, message)) => return json_error(status, &message),
    };
    let model_mapping = proxy_model_mapping(
        &upstream.profile,
        route_scope.as_deref(),
        client_protocol.api_type(),
        &target_api_type,
    );
    let codex_session_state = launch_id
        .as_deref()
        .and_then(|launch_id| state.hook_registry.codex_session_for_launch(launch_id));
    let manual_session_id = match manual_scope.as_deref() {
        Some(scope) => match manual_scope_session_id(scope) {
            Ok(session_id) => Some(session_id),
            Err(response) => return response,
        },
        None => None,
    };
    let provider_context = ProviderProxyContext {
        launch_id: codex_session_state
            .as_ref()
            .map(|state| state.launch_id.clone())
            .or_else(|| launch_id.clone()),
        session_id: codex_session_state
            .as_ref()
            .and_then(|state| state.session_id.clone())
            .or(manual_session_id),
        transcript_path: codex_session_state
            .as_ref()
            .and_then(|state| state.transcript_path.clone()),
    };
    let mut provider_adapter =
        ProviderProxyAdapter::for_profile(&upstream.profile, provider_context);
    let manual_profile_api_key = manual_scope
        .as_ref()
        .and_then(|_| upstream.profile.credentials.get("api_key").cloned());

    let mut universal_request = match client_protocol.decode_agent_request(original_request.clone())
    {
        Ok(request) => request,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, &error.to_string()),
    };
    if let Some(mapping) = &model_mapping {
        universal_request.model = Some(mapping.upstream_model.clone());
    }
    let mut upstream_request = match upstream
        .protocol
        .encode_upstream_request(&universal_request)
    {
        Ok(request) => request,
        Err(error) => return json_error(StatusCode::UNPROCESSABLE_ENTITY, &error.to_string()),
    };
    normalize_target_request(&mut upstream_request, upstream.protocol);
    if upstream.protocol == ProxyProtocol::OpenAiChat {
        provider_adapter.prepare_chat_request(&original_request, &mut upstream_request);
    } else if upstream.protocol == ProxyProtocol::AnthropicMessages {
        provider_adapter.prepare_anthropic_request(&mut upstream_request);
    }

    let stream = upstream_request
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let body = match serde_json::to_vec(&upstream_request) {
        Ok(body) => body,
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("failed to serialize proxy request: {e}"),
            );
        }
    };

    let mut request = state
        .preview_client
        .post(&upstream.url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body);
    for (name, value) in &upstream.headers {
        request = request.header(name.as_str(), value.as_str());
    }
    let request = match apply_upstream_auth(
        request,
        upstream.protocol,
        upstream.auth_header,
        &headers,
        manual_profile_api_key.as_deref(),
    ) {
        Ok(request) => request,
        Err(response) => return response,
    };

    tracing::info!(
        target: "server::web_server::api_proxy",
        profile_id = %profile_id,
        launch_id = ?launch_id,
        route_scope = ?route_scope,
        manual_scope = ?manual_scope,
        target_api_type = %target_api_type,
        upstream = %redacted_url(&upstream.url),
        proxy_model = ?model_mapping.as_ref().map(|mapping| mapping.upstream_model.as_str()),
        agent_model = ?model_mapping.as_ref().map(|mapping| mapping.agent_model.as_str()),
        stream = stream,
        "API proxy forwarding request"
    );

    let response = match request.send().await {
        Ok(response) => response,
        Err(e) => {
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("failed to reach upstream proxy endpoint: {e}"),
            );
        }
    };

    if !response.status().is_success() {
        return upstream_error_response(response).await;
    }

    if stream {
        translated_stream_response(
            response,
            upstream.protocol,
            client_protocol,
            provider_adapter,
            model_mapping.map(|mapping| mapping.agent_model),
        )
    } else {
        translated_completion_response(
            response,
            upstream.protocol,
            client_protocol,
            &mut provider_adapter,
            model_mapping.map(|mapping| mapping.agent_model),
        )
        .await
    }
}

#[derive(Debug, Clone)]
struct ProxyModelMapping {
    upstream_model: String,
    agent_model: String,
}

fn proxy_model_mapping(
    profile: &ProfileDef,
    route_scope: Option<&str>,
    client_api_type: &str,
    target_api_type: &str,
) -> Option<ProxyModelMapping> {
    let agent_id = agent_id_from_scope(route_scope?, client_api_type)?;
    let prefs = agent_state::read_prefs();
    let preference = prefs.profile_connections.get(&profile.id)?.get(agent_id)?;
    let proxy = preference.proxy.get(client_api_type)?;
    if !proxy.enabled {
        return None;
    }
    let configured_target = proxy.target_api_type.as_deref().unwrap_or(target_api_type);
    if configured_target != target_api_type {
        return None;
    }
    let upstream_model = clean_model_id(proxy.upstream_model.as_deref())
        .or_else(|| default_model(profile, target_api_type))?;
    let agent_model =
        clean_model_id(proxy.fake_model_id.as_deref()).unwrap_or_else(|| upstream_model.clone());
    Some(ProxyModelMapping {
        upstream_model,
        agent_model,
    })
}

fn agent_id_from_scope(scope: &str, client_api_type: &str) -> Option<&'static str> {
    for agent_id in ["claude", "codex", "opencode"] {
        let prefix = format!("{agent_id}-");
        if scope.strip_prefix(&prefix) == Some(client_api_type) {
            return Some(agent_id);
        }
    }
    None
}

fn default_model(profile: &ProfileDef, target_api_type: &str) -> Option<String> {
    let provider = catalog::get(&profile.provider)?;
    let endpoint_id = profile
        .overrides
        .get(target_api_type)
        .and_then(|overrides| overrides.endpoint_id.as_deref());
    let endpoint = catalog::find_endpoint(provider, target_api_type, endpoint_id)?;
    profile
        .overrides
        .get(target_api_type)
        .and_then(|overrides| clean_model_id(overrides.model.as_deref()))
        .or_else(|| {
            endpoint
                .models
                .first()
                .and_then(|model| clean_model_id(Some(&model.id)))
        })
}

fn clean_model_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn manual_scope_session_id(scope: &str) -> Result<String, Response> {
    if scope.is_empty() {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "manual proxy scope must not be empty",
        ));
    }
    if scope.len() > 128 || !scope.chars().all(is_manual_scope_char) {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "manual proxy scope must be 1-128 characters and contain only ASCII letters, digits, '.', '_' or '-'",
        ));
    }
    Ok(format!("manual:{scope}"))
}

fn is_manual_scope_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(json!({
            "error": {
                "message": message,
                "type": "vibearound_proxy_error",
            }
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::manual_scope_session_id;

    #[test]
    fn accepts_manual_proxy_scope() {
        assert_eq!(
            manual_scope_session_id("codex.project_1").unwrap(),
            "manual:codex.project_1"
        );
    }

    #[test]
    fn rejects_invalid_manual_proxy_scope() {
        assert!(manual_scope_session_id("").is_err());
        assert!(manual_scope_session_id("codex/project").is_err());
        assert!(manual_scope_session_id("codex project").is_err());
        assert!(manual_scope_session_id(&"a".repeat(129)).is_err());
    }
}
