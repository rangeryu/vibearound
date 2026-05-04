use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use va_ai_api_proxy::{
    AnthropicMessagesTranslator, DecodeState, EncodeState, OpenAiChatTranslator,
    OpenAiResponsesTranslator, UniversalEvent, WireEvent, WireTranslator,
};

mod completion;
mod stream;
mod upstream;

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
    target_api_type: String,
    client_protocol: ProxyProtocol,
    headers: HeaderMap,
    original_request: Value,
) -> Response {
    let upstream = match upstream_endpoint(&profile_id, &target_api_type) {
        Ok(endpoint) => endpoint,
        Err((status, message)) => return json_error(status, &message),
    };

    let universal_request = match client_protocol.decode_agent_request(original_request.clone()) {
        Ok(request) => request,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, &error.to_string()),
    };
    let mut upstream_request = match upstream
        .protocol
        .encode_upstream_request(&universal_request)
    {
        Ok(request) => request,
        Err(error) => return json_error(StatusCode::UNPROCESSABLE_ENTITY, &error.to_string()),
    };
    normalize_target_request(&mut upstream_request, upstream.protocol);

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

    let request = state
        .preview_client
        .post(&upstream.url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body);
    let request = match apply_upstream_auth(request, upstream.protocol, &headers) {
        Ok(request) => request,
        Err(response) => return response,
    };

    tracing::info!(
        target: "server::web_server::api_proxy",
        profile_id = %profile_id,
        launch_id = ?launch_id,
        target_api_type = %target_api_type,
        upstream = %redacted_url(&upstream.url),
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
        translated_stream_response(response, upstream.protocol, client_protocol)
    } else {
        translated_completion_response(response, upstream.protocol, client_protocol).await
    }
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
