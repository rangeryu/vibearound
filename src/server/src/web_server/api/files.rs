use axum::body::Body;
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use crate::api_types::ChatUploadResponse;
use crate::web_server::AppState;

const DEFAULT_UPLOAD_MIME_TYPE: &str = "application/octet-stream";

/// Hard cap on a single chat upload. Larger payloads are rejected with 413
/// before they touch disk. The route also carries `DefaultBodyLimit::max`
/// at a higher value as a coarse safety net.
const MAX_UPLOAD_SIZE_BYTES: usize = 20 * 1024 * 1024;

/// Allowed MIME prefixes for chat uploads. Specific exact types
/// outside these prefixes are listed in `ALLOWED_EXACT_MIME_TYPES`.
const ALLOWED_MIME_PREFIXES: &[&str] = &["image/", "text/"];

const ALLOWED_EXACT_MIME_TYPES: &[&str] = &[
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/rtf",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.presentation",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.apple.pages",
    "application/vnd.apple.keynote",
    "application/vnd.apple.numbers",
    "application/json",
    "application/x-ndjson",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/toml",
    "application/javascript",
    "application/x-javascript",
    "application/typescript",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-tar",
    "application/gzip",
    "application/x-gzip",
    "application/x-7z-compressed",
    "application/vnd.rar",
    "application/x-rar-compressed",
];

#[derive(Debug, Deserialize)]
pub struct UploadChatFileQuery {
    filename: Option<String>,
    mime_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DownloadChatFileQuery {
    uri: String,
    name: Option<String>,
    mime_type: Option<String>,
    #[serde(default)]
    inline: bool,
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

    if body.len() > MAX_UPLOAD_SIZE_BYTES {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            format!(
                "uploaded file exceeds {} MB limit",
                MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)
            ),
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
    let supplied_mime_type = query
        .mime_type
        .as_deref()
        .or_else(|| {
            headers
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
        })
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mime_type =
        if let Some(supplied) = supplied_mime_type.filter(|value| !is_generic_upload_mime(value)) {
            supplied.to_string()
        } else if let Some(inferred) = mime_for_file_name(&name) {
            inferred.to_string()
        } else if let Some(supplied) = supplied_mime_type {
            supplied.to_string()
        } else {
            DEFAULT_UPLOAD_MIME_TYPE.to_string()
        };

    if !is_allowed_upload_mime(&mime_type) {
        return Err((
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            format!("file type {mime_type} is not allowed"),
        ));
    }

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

pub async fn download_chat_file_handler(
    State(state): State<AppState>,
    Query(query): Query<DownloadChatFileQuery>,
) -> Result<Response, (StatusCode, String)> {
    let uri = query.uri.trim();
    if uri.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "missing file uri".to_string()));
    }

    let file_name = query
        .name
        .as_deref()
        .map(safe_file_name)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| file_name_from_uri(uri));
    let content_type = query
        .mime_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if uri.starts_with("http://") || uri.starts_with("https://") {
        return proxy_remote_file(&state, uri, &file_name, content_type, query.inline).await;
    }

    let path = if let Some(path) = uri.strip_prefix("file://") {
        std::path::PathBuf::from(percent_decode(path))
    } else if uri.starts_with('/') {
        std::path::PathBuf::from(uri)
    } else {
        return Err((
            StatusCode::BAD_REQUEST,
            "unsupported file uri scheme".to_string(),
        ));
    };

    let bytes = tokio::fs::read(&path).await.map_err(|error| {
        (
            StatusCode::NOT_FOUND,
            format!("failed to read file {}: {error}", path.display()),
        )
    })?;
    let content_type = content_type
        .or_else(|| mime_for_file_name(&file_name).map(ToOwned::to_owned))
        .unwrap_or_else(|| DEFAULT_UPLOAD_MIME_TYPE.to_string());
    Ok(file_response(
        bytes.into(),
        &file_name,
        &content_type,
        query.inline,
    ))
}

async fn proxy_remote_file(
    state: &AppState,
    uri: &str,
    file_name: &str,
    content_type: Option<String>,
    inline: bool,
) -> Result<Response, (StatusCode, String)> {
    let upstream = state
        .preview_client
        .get(uri)
        .send()
        .await
        .map_err(|error| {
            (
                StatusCode::BAD_GATEWAY,
                format!("upstream request failed: {error}"),
            )
        })?;
    if !upstream.status().is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("upstream returned {}", upstream.status()),
        ));
    }
    let content_type = content_type
        .or_else(|| {
            upstream
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .map(ToOwned::to_owned)
        })
        .or_else(|| mime_for_file_name(file_name).map(ToOwned::to_owned))
        .unwrap_or_else(|| DEFAULT_UPLOAD_MIME_TYPE.to_string());
    let bytes = upstream.bytes().await.map_err(|error| {
        (
            StatusCode::BAD_GATEWAY,
            format!("failed to read upstream body: {error}"),
        )
    })?;
    Ok(file_response(bytes, file_name, &content_type, inline))
}

fn file_response(bytes: Bytes, file_name: &str, content_type: &str, inline: bool) -> Response {
    let disposition = if inline { "inline" } else { "attachment" };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CONTENT_DISPOSITION,
            content_disposition(disposition, file_name),
        )
        .body(Body::from(bytes))
        .unwrap_or_else(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to build download response: {error}"),
            )
                .into_response()
        })
}

fn is_allowed_upload_mime(mime: &str) -> bool {
    let normalized = normalized_mime(mime);
    if normalized.is_empty() {
        return false;
    }
    if ALLOWED_MIME_PREFIXES
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
    {
        return true;
    }
    ALLOWED_EXACT_MIME_TYPES
        .iter()
        .any(|allowed| normalized == *allowed)
}

fn is_generic_upload_mime(mime: &str) -> bool {
    matches!(
        normalized_mime(mime).as_str(),
        "application/octet-stream" | "binary/octet-stream"
    )
}

fn normalized_mime(mime: &str) -> String {
    mime.split(';')
        .next()
        .map(str::trim)
        .unwrap_or("")
        .to_ascii_lowercase()
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

fn file_name_from_uri(uri: &str) -> String {
    let without_query = uri.split(['?', '#']).next().unwrap_or(uri);
    let decoded = percent_decode(without_query);
    decoded
        .rsplit(['/', '\\'])
        .find(|part| !part.is_empty())
        .map(safe_file_name)
        .filter(|part| !part.is_empty())
        .unwrap_or_else(|| "download".to_string())
}

fn mime_for_file_name(file_name: &str) -> Option<&'static str> {
    let ext = file_name.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "txt" | "log" | "dockerfile" | "makefile" | "readme" | "license" | "notice"
        | "gitignore" | "dockerignore" | "editorconfig" | "lock" => {
            Some("text/plain; charset=utf-8")
        }
        "md" | "markdown" => Some("text/markdown; charset=utf-8"),
        "json" => Some("application/json"),
        "jsonl" => Some("application/x-ndjson"),
        "csv" => Some("text/csv; charset=utf-8"),
        "tsv" => Some("text/tab-separated-values; charset=utf-8"),
        "html" | "htm" => Some("text/html; charset=utf-8"),
        "xml" => Some("application/xml"),
        "yaml" | "yml" => Some("application/yaml"),
        "toml" => Some("application/toml"),
        "js" | "jsx" => Some("application/javascript"),
        "ts" | "tsx" => Some("application/typescript"),
        "css" => Some("text/css; charset=utf-8"),
        "scss" | "sass" | "less" | "py" | "java" | "c" | "cpp" | "h" | "hpp" | "cs" | "go"
        | "rs" | "rb" | "php" | "swift" | "kt" | "kts" | "sh" | "bash" | "zsh" | "fish" | "sql"
        | "ini" | "conf" | "cfg" | "env" => Some("text/plain; charset=utf-8"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "heic" => Some("image/heic"),
        "heif" => Some("image/heif"),
        "bmp" => Some("image/bmp"),
        "tif" | "tiff" => Some("image/tiff"),
        "svg" => Some("image/svg+xml"),
        "pdf" => Some("application/pdf"),
        "doc" => Some("application/msword"),
        "docx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "rtf" => Some("application/rtf"),
        "odt" => Some("application/vnd.oasis.opendocument.text"),
        "pages" => Some("application/vnd.apple.pages"),
        "ppt" => Some("application/vnd.ms-powerpoint"),
        "pptx" => Some("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        "odp" => Some("application/vnd.oasis.opendocument.presentation"),
        "key" => Some("application/vnd.apple.keynote"),
        "xls" => Some("application/vnd.ms-excel"),
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "ods" => Some("application/vnd.oasis.opendocument.spreadsheet"),
        "numbers" => Some("application/vnd.apple.numbers"),
        "zip" => Some("application/zip"),
        "tar" => Some("application/x-tar"),
        "gz" | "tgz" => Some("application/gzip"),
        "7z" => Some("application/x-7z-compressed"),
        "rar" => Some("application/vnd.rar"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "mp4" => Some("video/mp4"),
        _ => None,
    }
}

fn content_disposition(disposition: &str, file_name: &str) -> String {
    let fallback = ascii_file_name(file_name);
    format!(
        "{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{}",
        percent_encode(file_name)
    )
}

fn ascii_file_name(file_name: &str) -> String {
    let out = file_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if out.is_empty() {
        "download".to_string()
    } else {
        out
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

fn percent_encode(input: &str) -> String {
    let mut out = String::new();
    for byte in input.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'.' | b'-' | b'_') {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn from_hex(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        content_disposition, is_allowed_upload_mime, is_generic_upload_mime, mime_for_file_name,
        safe_file_name,
    };

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

    #[test]
    fn allowed_mime_types_pass_whitelist() {
        assert!(is_allowed_upload_mime("image/png"));
        assert!(is_allowed_upload_mime("image/jpeg"));
        assert!(is_allowed_upload_mime("image/svg+xml"));
        assert!(is_allowed_upload_mime("text/plain; charset=utf-8"));
        assert!(is_allowed_upload_mime("text/markdown"));
        assert!(is_allowed_upload_mime("application/pdf"));
        assert!(is_allowed_upload_mime("application/msword"));
        assert!(is_allowed_upload_mime(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ));
        assert!(is_allowed_upload_mime(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ));
        assert!(is_allowed_upload_mime(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ));
        assert!(is_allowed_upload_mime("application/json"));
        assert!(is_allowed_upload_mime("application/javascript"));
        assert!(is_allowed_upload_mime("application/zip"));
    }

    #[test]
    fn disallowed_mime_types_blocked() {
        assert!(!is_allowed_upload_mime("application/x-msdownload"));
        assert!(!is_allowed_upload_mime("application/octet-stream"));
        assert!(!is_allowed_upload_mime("video/mp4"));
        assert!(!is_allowed_upload_mime(""));
    }

    #[test]
    fn generic_upload_mimes_can_be_replaced_by_filename_inference() {
        assert!(is_generic_upload_mime("application/octet-stream"));
        assert!(is_generic_upload_mime(
            "binary/octet-stream; charset=binary"
        ));
        assert!(!is_generic_upload_mime("application/pdf"));
    }

    #[test]
    fn infers_common_document_mimes_from_file_names() {
        assert_eq!(
            mime_for_file_name("report.docx"),
            Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        );
        assert_eq!(
            mime_for_file_name("slides.pptx"),
            Some("application/vnd.openxmlformats-officedocument.presentationml.presentation")
        );
        assert_eq!(
            mime_for_file_name("sheet.xlsx"),
            Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        );
        assert_eq!(
            mime_for_file_name("notes.md"),
            Some("text/markdown; charset=utf-8")
        );
        assert_eq!(mime_for_file_name("archive.zip"), Some("application/zip"));
        assert_eq!(
            mime_for_file_name("Dockerfile"),
            Some("text/plain; charset=utf-8")
        );
    }

    #[test]
    fn builds_rfc5987_content_disposition() {
        assert_eq!(
            content_disposition("attachment", "报告.md"),
            "attachment; filename=\"__.md\"; filename*=UTF-8''%E6%8A%A5%E5%91%8A.md"
        );
    }
}
