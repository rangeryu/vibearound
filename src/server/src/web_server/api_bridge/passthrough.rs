use std::io;

use axum::body::Body;
use axum::http::{HeaderName, HeaderValue, Response, StatusCode};
use bytes::Bytes;
use futures_util::StreamExt;

use super::json_error;

pub(super) async fn buffered_passthrough_response(upstream: reqwest::Response) -> Response<Body> {
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let builder = response_builder(&upstream, status);
    let bytes = match upstream.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            return json_error(
                StatusCode::BAD_GATEWAY,
                &format!("failed to read upstream passthrough response: {error}"),
            );
        }
    };
    builder.body(Body::from(bytes)).unwrap_or_else(|_| {
        json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to build buffered passthrough bridge response",
        )
    })
}

pub(super) fn passthrough_response(upstream: reqwest::Response) -> Response<Body> {
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let builder = response_builder(&upstream, status);
    let stream = upstream.bytes_stream().map(|chunk| {
        chunk.map_err(|error| {
            io::Error::new(
                io::ErrorKind::Other,
                format!("upstream passthrough stream error: {error}"),
            )
        })
    });
    builder.body(Body::from_stream(stream)).unwrap_or_else(|_| {
        json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to build passthrough bridge response",
        )
    })
}

fn response_builder(
    upstream: &reqwest::Response,
    status: StatusCode,
) -> axum::http::response::Builder {
    let mut builder = Response::builder().status(status);
    for (name, value) in upstream.headers() {
        if !should_forward_response_header(name.as_str()) {
            continue;
        }
        let Ok(header_name) = HeaderName::from_bytes(name.as_str().as_bytes()) else {
            continue;
        };
        let Ok(header_value) = HeaderValue::from_bytes(value.as_bytes()) else {
            continue;
        };
        builder = builder.header(header_name, header_value);
    }
    builder
}

fn should_forward_response_header(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "content-length"
    )
}

#[allow(dead_code)]
fn _assert_body_stream_error_is_send(_: Result<Bytes, io::Error>) {}
