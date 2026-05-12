use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use common::profiles::headers::merged_upstream_headers;
use serde_json::{json, Value};

mod completion;
mod model_mapping;
mod passthrough;
mod protocol;
mod routes;
mod stream;
mod upstream;

use crate::openai_proxy::providers::ProviderProxyAdapter;

use completion::translated_completion_response;
use model_mapping::{proxy_model_mapping, proxy_route_preference};
use passthrough::{buffered_passthrough_response, passthrough_response};
pub(super) use protocol::ProxyProtocol;
pub use routes::{
    legacy_chat_completions_handler, legacy_messages_handler, legacy_responses_handler,
    local_chat_completions_handler, local_messages_handler, local_responses_handler,
};
use stream::translated_stream_response;
use upstream::{
    apply_upstream_auth, normalize_target_request, redacted_url, upstream_endpoint,
    upstream_error_response,
};

use super::AppState;

pub(super) async fn proxy_handler(
    state: AppState,
    profile_id: String,
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
    let proxy_preference = proxy_route_preference(
        &upstream.profile,
        route_scope.as_deref(),
        client_protocol.api_type(),
        &target_api_type,
    );
    let model_mapping = proxy_model_mapping(
        &upstream.profile,
        proxy_preference.as_ref(),
        &target_api_type,
    );
    if let Some(scope) = manual_scope.as_deref() {
        if let Err(response) = validate_manual_scope(scope) {
            return response;
        }
    }
    let mut provider_adapter = ProviderProxyAdapter::for_profile(&upstream.profile);
    let manual_profile_api_key = manual_scope
        .as_ref()
        .and_then(|_| upstream.profile.credentials.get("api_key").cloned());

    let agent_request = original_request;

    if client_protocol == upstream.protocol {
        let stream = agent_request
            .get("stream")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let body = match serde_json::to_vec(&agent_request) {
            Ok(body) => body,
            Err(e) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("failed to serialize proxy request: {e}"),
                );
            }
        };
        let upstream_headers = match merged_upstream_headers(
            &upstream.headers,
            proxy_preference
                .as_ref()
                .map(|preference| &preference.headers),
        ) {
            Ok(headers) => headers,
            Err(error) => return json_error(StatusCode::BAD_REQUEST, &error.to_string()),
        };
        let request = state
            .preview_client
            .post(&upstream.url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .headers(upstream_headers)
            .body(body);
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
            route_scope = ?route_scope,
            manual_scope = ?manual_scope,
            target_api_type = %target_api_type,
            upstream = %redacted_url(&upstream.url),
            stream = stream,
            "API proxy passthrough forwarding request"
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
        if !stream {
            return buffered_passthrough_response(response).await;
        }
        return passthrough_response(response);
    }

    let mut universal_request = match client_protocol.decode_agent_request(agent_request.clone()) {
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
        provider_adapter.prepare_chat_request(
            client_protocol.provider_request_source(),
            &agent_request,
            &mut upstream_request,
        );
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

    let upstream_headers = match merged_upstream_headers(
        &upstream.headers,
        proxy_preference
            .as_ref()
            .map(|preference| &preference.headers),
    ) {
        Ok(headers) => headers,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, &error.to_string()),
    };

    let request = state
        .preview_client
        .post(&upstream.url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .headers(upstream_headers)
        .body(body);
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

fn validate_manual_scope(scope: &str) -> Result<(), Response> {
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
    Ok(())
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
    use super::validate_manual_scope;

    #[test]
    fn accepts_manual_proxy_scope() {
        validate_manual_scope("codex.project_1").unwrap();
    }

    #[test]
    fn rejects_invalid_manual_proxy_scope() {
        assert!(validate_manual_scope("").is_err());
        assert!(validate_manual_scope("codex/project").is_err());
        assert!(validate_manual_scope("codex project").is_err());
        assert!(validate_manual_scope(&"a".repeat(129)).is_err());
    }
}
