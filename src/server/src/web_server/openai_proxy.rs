use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use axum::Json;
use serde_json::Value;

use super::AppState;

pub async fn responses_handler(
    State(state): State<AppState>,
    Path((profile_id, launch_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    responses_handler_inner(
        state,
        profile_id,
        Some(launch_id),
        headers,
        original_request,
    )
    .await
}

pub async fn legacy_responses_handler(
    State(state): State<AppState>,
    Path(profile_id): Path<String>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    responses_handler_inner(state, profile_id, None, headers, original_request).await
}

async fn responses_handler_inner(
    state: AppState,
    profile_id: String,
    launch_id: Option<String>,
    headers: HeaderMap,
    original_request: Value,
) -> Response {
    super::api_proxy::proxy_handler(
        state,
        profile_id,
        launch_id,
        None,
        None,
        "openai-chat".to_string(),
        super::api_proxy::ProxyProtocol::OpenAiResponses,
        headers,
        original_request,
    )
    .await
}
