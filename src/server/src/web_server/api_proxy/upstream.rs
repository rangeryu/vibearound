use axum::body::Body;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::{json, Value};

use common::profiles::schema::ProfileDef;
use common::profiles::{catalog, normalize_legacy_profile, schema};

use super::{json_error, ProxyProtocol};

pub(super) struct UpstreamEndpoint {
    pub(super) url: String,
    pub(super) protocol: ProxyProtocol,
    pub(super) profile: ProfileDef,
}

pub(super) fn upstream_endpoint(
    profile_id: &str,
    target_api_type: &str,
) -> Result<UpstreamEndpoint, (StatusCode, String)> {
    let protocol = ProxyProtocol::from_api_type(target_api_type).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            format!("unsupported proxy target api kind '{target_api_type}'"),
        )
    })?;
    let profile = schema::load(profile_id)
        .map(normalize_legacy_profile)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("profile '{profile_id}' not found"),
            )
        })?;
    if !profile
        .api_types
        .iter()
        .any(|api_type| api_type == target_api_type)
    {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "profile '{}' does not expose api kind '{}'",
                profile.id, target_api_type
            ),
        ));
    }
    let provider = catalog::get(&profile.provider).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            format!("unknown provider '{}'", profile.provider),
        )
    })?;
    let endpoint = provider
        .endpoints
        .iter()
        .find(|endpoint| endpoint.api_type == target_api_type)
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                format!(
                    "provider '{}' does not expose api kind '{}'",
                    profile.provider, target_api_type
                ),
            )
        })?;
    let base_url = profile
        .overrides
        .get(target_api_type)
        .and_then(|overrides| overrides.base_url.clone())
        .unwrap_or_else(|| endpoint.default_base_url.clone());
    let base_url = base_url.trim_end_matches('/');
    if base_url.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "profile '{}' has no base URL for api kind '{}'",
                profile.id, target_api_type
            ),
        ));
    }

    let url = match protocol {
        ProxyProtocol::OpenAiResponses => join_versioned_endpoint(base_url, "responses"),
        ProxyProtocol::OpenAiChat => join_versioned_endpoint(base_url, "chat/completions"),
        ProxyProtocol::AnthropicMessages => join_versioned_endpoint(base_url, "messages"),
    };
    Ok(UpstreamEndpoint {
        url,
        protocol,
        profile,
    })
}

fn join_versioned_endpoint(base_url: &str, endpoint: &str) -> String {
    if base_url.ends_with("/v1") {
        format!("{base_url}/{endpoint}")
    } else {
        format!("{base_url}/v1/{endpoint}")
    }
}

pub(super) fn normalize_target_request(request: &mut Value, protocol: ProxyProtocol) {
    if protocol == ProxyProtocol::AnthropicMessages {
        if let Some(object) = request.as_object_mut() {
            object
                .entry("max_tokens")
                .or_insert_with(|| Value::Number(4096_u64.into()));
        }
    }
}

pub(super) fn apply_upstream_auth(
    request: reqwest::RequestBuilder,
    protocol: ProxyProtocol,
    headers: &HeaderMap,
    profile_api_key: Option<&str>,
) -> Result<reqwest::RequestBuilder, Response> {
    let profile_api_key = profile_api_key
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let api_key = profile_api_key
        .map(ToString::to_string)
        .or_else(|| inbound_api_key(headers));
    if protocol.is_openai_family() {
        let auth = match profile_api_key {
            Some(key) => Some(format!("Bearer {key}")),
            None => authorization_header(headers)
                .or_else(|| api_key.as_ref().map(|key| format!("Bearer {key}"))),
        };
        let Some(auth) = auth else {
            return Err(json_error(
                StatusCode::UNAUTHORIZED,
                "missing Authorization or x-api-key header",
            ));
        };
        return Ok(request.header(reqwest::header::AUTHORIZATION, auth));
    }

    let Some(api_key) = api_key else {
        return Err(json_error(
            StatusCode::UNAUTHORIZED,
            "missing x-api-key or Authorization header",
        ));
    };
    let mut request = request.header("x-api-key", api_key);
    if profile_api_key.is_none() {
        if let Some(auth) = authorization_header(headers) {
            request = request.header(reqwest::header::AUTHORIZATION, auth);
        }
    }
    let anthropic_version = headers
        .get("anthropic-version")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("2023-06-01");
    Ok(request.header("anthropic-version", anthropic_version))
}

fn authorization_header(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string)
}

fn inbound_api_key(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            authorization_header(headers).and_then(|auth| {
                auth.strip_prefix("Bearer ")
                    .or_else(|| auth.strip_prefix("bearer "))
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
            })
        })
}

pub(super) async fn upstream_error_response(upstream: reqwest::Response) -> Response {
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string)
        .unwrap_or_else(|| "application/json".to_string());
    let body = match upstream.bytes().await {
        Ok(bytes) => Body::from(bytes),
        Err(e) => Body::from(
            json!({ "error": { "message": format!("failed to read upstream error body: {e}") } })
                .to_string(),
        ),
    };
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .body(body)
        .unwrap_or_else(|_| json_error(StatusCode::BAD_GATEWAY, "upstream request failed"))
}

pub(super) fn redacted_url(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(mut parsed) => {
            parsed.set_query(None);
            parsed.to_string()
        }
        Err(_) => url.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::{header, HeaderMap, HeaderValue};

    use super::{apply_upstream_auth, ProxyProtocol};

    #[test]
    fn profile_key_overrides_openai_inbound_auth() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer dummy-key"),
        );

        let request = apply_upstream_auth(
            reqwest::Client::new().post("http://127.0.0.1/v1/chat/completions"),
            ProxyProtocol::OpenAiChat,
            &headers,
            Some("sk-profile"),
        )
        .unwrap()
        .build()
        .unwrap();

        assert_eq!(
            request
                .headers()
                .get(reqwest::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer sk-profile")
        );
    }

    #[test]
    fn profile_key_overrides_anthropic_key_without_forwarding_dummy_auth() {
        let mut headers = HeaderMap::new();
        headers.insert("x-api-key", HeaderValue::from_static("dummy-key"));
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer dummy-key"),
        );

        let request = apply_upstream_auth(
            reqwest::Client::new().post("http://127.0.0.1/v1/messages"),
            ProxyProtocol::AnthropicMessages,
            &headers,
            Some("sk-profile"),
        )
        .unwrap()
        .build()
        .unwrap();

        assert_eq!(
            request
                .headers()
                .get("x-api-key")
                .and_then(|value| value.to_str().ok()),
            Some("sk-profile")
        );
        assert!(request
            .headers()
            .get(reqwest::header::AUTHORIZATION)
            .is_none());
    }
}
