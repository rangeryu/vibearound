use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use axum::Json;
use serde_json::Value;

use super::super::AppState;
use super::{bridge_handler, BridgeProtocol};

pub async fn legacy_responses_handler(
    State(state): State<AppState>,
    Path((profile_id, target_api_type)): Path<(String, String)>,
    headers: HeaderMap,
    Json(original_request): Json<Value>,
) -> Response {
    bridge_handler(
        state,
        profile_id,
        None,
        None,
        target_api_type,
        BridgeProtocol::OpenAiResponses,
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
    bridge_handler(
        state,
        profile_id,
        Some(route_scope),
        Some(scope),
        target_api_type,
        BridgeProtocol::OpenAiResponses,
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
    bridge_handler(
        state,
        profile_id,
        None,
        None,
        target_api_type,
        BridgeProtocol::OpenAiChat,
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
    bridge_handler(
        state,
        profile_id,
        Some(route_scope),
        Some(scope),
        target_api_type,
        BridgeProtocol::OpenAiChat,
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
    bridge_handler(
        state,
        profile_id,
        None,
        None,
        target_api_type,
        BridgeProtocol::AnthropicMessages,
        headers,
        original_request,
    )
    .await
}

pub async fn legacy_models_handler(
    Path((profile_id, target_api_type)): Path<(String, String)>,
) -> Response {
    super::models_handler(profile_id, None, None, target_api_type).await
}

pub async fn legacy_gemini_generate_content_handler(
    State(state): State<AppState>,
    Path((profile_id, target_api_type, _version, model_action)): Path<(
        String,
        String,
        String,
        String,
    )>,
    headers: HeaderMap,
    Json(mut original_request): Json<Value>,
) -> Response {
    let Some((model, action)) = parse_gemini_model_action(&model_action) else {
        return super::json_error(
            axum::http::StatusCode::BAD_REQUEST,
            "Gemini route must end with {model}:generateContent or {model}:streamGenerateContent",
        );
    };
    va_ai_api_bridge::translator::gemini_generate_content::attach_route_metadata(
        &mut original_request,
        model,
        action == "streamGenerateContent",
    );
    bridge_handler(
        state,
        profile_id,
        None,
        None,
        target_api_type,
        BridgeProtocol::GeminiGenerateContent,
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
    bridge_handler(
        state,
        profile_id,
        Some(route_scope),
        Some(scope),
        target_api_type,
        BridgeProtocol::AnthropicMessages,
        headers,
        original_request,
    )
    .await
}

pub async fn local_models_handler(
    Path((profile_id, scope, target_api_type)): Path<(String, String, String)>,
) -> Response {
    let route_scope = scope.clone();
    super::models_handler(profile_id, Some(route_scope), Some(scope), target_api_type).await
}

pub async fn local_gemini_generate_content_handler(
    State(state): State<AppState>,
    Path((profile_id, scope, target_api_type, _version, model_action)): Path<(
        String,
        String,
        String,
        String,
        String,
    )>,
    headers: HeaderMap,
    Json(mut original_request): Json<Value>,
) -> Response {
    let Some((model, action)) = parse_gemini_model_action(&model_action) else {
        return super::json_error(
            axum::http::StatusCode::BAD_REQUEST,
            "Gemini route must end with {model}:generateContent or {model}:streamGenerateContent",
        );
    };
    va_ai_api_bridge::translator::gemini_generate_content::attach_route_metadata(
        &mut original_request,
        model,
        action == "streamGenerateContent",
    );
    let route_scope = scope.clone();
    bridge_handler(
        state,
        profile_id,
        Some(route_scope),
        Some(scope),
        target_api_type,
        BridgeProtocol::GeminiGenerateContent,
        headers,
        original_request,
    )
    .await
}

fn parse_gemini_model_action(model_action: &str) -> Option<(&str, &str)> {
    let (model, action) = model_action.rsplit_once(':')?;
    matches!(action, "generateContent" | "streamGenerateContent").then_some((model, action))
}
