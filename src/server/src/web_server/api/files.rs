use axum::body::Bytes;
use axum::extract::Query;
use axum::http::{header, HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use crate::api_types::ChatUploadResponse;

const DEFAULT_UPLOAD_MIME_TYPE: &str = "application/octet-stream";

#[derive(Debug, Deserialize)]
pub struct UploadChatFileQuery {
    filename: Option<String>,
    mime_type: Option<String>,
}

pub async fn upload_chat_file_handler(
    Query(query): Query<UploadChatFileQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<ChatUploadResponse>, (StatusCode, String)> {
    if body.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "uploaded file is empty".to_string(),
        ));
    }

    let id = Uuid::new_v4().to_string();
    let name = safe_file_name(
        query
            .filename
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("attachment"),
    );
    let mime_type = query
        .mime_type
        .as_deref()
        .or_else(|| {
            headers
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_UPLOAD_MIME_TYPE)
        .to_string();

    let upload_dir = common::config::data_dir()
        .join(".cache")
        .join("web-uploads")
        .join(&id);
    tokio::fs::create_dir_all(&upload_dir)
        .await
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to create upload directory: {error}"),
            )
        })?;

    let path = upload_dir.join(&name);
    tokio::fs::write(&path, &body).await.map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to store upload: {error}"),
        )
    })?;
    if let Err(error) = common::auth::set_owner_only(&path) {
        tracing::warn!(
            "[VibeAround] failed to restrict uploaded chat file {:?}: {}",
            path,
            error
        );
    }

    Ok(Json(ChatUploadResponse {
        id,
        name,
        mime_type,
        size: body.len() as u64,
        uri: format!("file://{}", path.to_string_lossy()),
    }))
}

fn safe_file_name(value: &str) -> String {
    let base = value
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(value)
        .trim()
        .trim_matches('.');
    let mut out = String::with_capacity(base.len().min(160));
    for ch in base.chars().take(160) {
        if ch.is_control() || matches!(ch, '/' | '\\' | ':') {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    if out.is_empty() {
        "attachment".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::safe_file_name;

    #[test]
    fn strips_path_segments_from_upload_names() {
        assert_eq!(safe_file_name("../secret.txt"), "secret.txt");
        assert_eq!(safe_file_name("C:\\tmp\\hello.md"), "hello.md");
    }

    #[test]
    fn falls_back_for_empty_upload_names() {
        assert_eq!(safe_file_name("..."), "attachment");
        assert_eq!(safe_file_name(""), "attachment");
    }
}
