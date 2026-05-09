use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use axum::Json;
use serde_json::Value;

use super::super::AppState;
use super::{proxy_handler, ProxyProtocol};

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
