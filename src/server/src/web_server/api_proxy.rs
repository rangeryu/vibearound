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
mod session;
mod stream;
mod upstream;

use crate::openai_proxy::providers::{ProviderProxyAdapter, ProviderProxyContext};

use completion::translated_completion_response;
use model_mapping::{proxy_model_mapping, proxy_route_preference};
use passthrough::{buffered_passthrough_response, passthrough_response};
pub(super) use protocol::ProxyProtocol;
pub use routes::{
    chat_completions_handler, legacy_chat_completions_handler, legacy_messages_handler,
    legacy_responses_handler, local_chat_completions_handler, local_messages_handler,
    local_responses_handler, messages_handler, responses_handler, scoped_chat_completions_handler,
    scoped_messages_handler, scoped_responses_handler,
};
use session::{PreparedAgentRequest, ProxySessionLedger, ProxySessionMetadata};
use stream::translated_stream_response;
use upstream::{
    apply_upstream_auth, normalize_target_request, redacted_url, upstream_endpoint,
    upstream_error_response,
};

use super::AppState;

pub(super) async fn proxy_handler(
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

    let session_metadata = ProxySessionMetadata {
        profile_id: profile_id.clone(),
        provider: upstream.profile.provider.clone(),
        launch_id: launch_id.clone(),
        route_scope: route_scope.clone(),
        manual_scope: manual_scope.clone(),
        agent: codex_session_state
            .as_ref()
            .and_then(|state| state.source.clone())
            .or_else(|| route_scope.clone()),
        workspace: codex_session_state
            .as_ref()
            .and_then(|state| state.cwd.clone()),
        client_protocol,
        upstream_protocol: upstream.protocol,
    };
    let expand_previous_response = client_protocol == ProxyProtocol::OpenAiResponses
        && upstream.protocol != ProxyProtocol::OpenAiResponses;
    let PreparedAgentRequest {
        ledger: session_ledger,
        request: agent_request,
    } = match ProxySessionLedger::prepare(
        session_metadata,
        original_request,
        expand_previous_response,
    ) {
        Ok(prepared) => prepared,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, &error),
    };

    if client_protocol == upstream.protocol {
        let stream = agent_request
            .get("stream")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if let Err(error) = session_ledger.append_upstream_request(&agent_request) {
            tracing::warn!(error = %error, "failed to record passthrough upstream request");
        }
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
            launch_id = ?launch_id,
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
            return buffered_passthrough_response(response, &session_ledger).await;
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
    if let Err(error) = session_ledger.append_upstream_request(&upstream_request) {
        tracing::warn!(error = %error, "failed to record translated upstream request");
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

    let agent_response_id = (client_protocol == ProxyProtocol::OpenAiResponses
        && upstream.protocol != ProxyProtocol::OpenAiResponses)
        .then(|| session_ledger.response_id());
    if stream {
        translated_stream_response(
            response,
            upstream.protocol,
            client_protocol,
            provider_adapter,
            model_mapping.map(|mapping| mapping.agent_model),
            Some(session_ledger),
            agent_response_id,
        )
    } else {
        translated_completion_response(
            response,
            upstream.protocol,
            client_protocol,
            &mut provider_adapter,
            model_mapping.map(|mapping| mapping.agent_model),
            Some(&session_ledger),
            agent_response_id,
        )
        .await
    }
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
