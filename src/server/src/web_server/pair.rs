//! Browser pairing API endpoints.
//!
//! - POST /va/api/pair/start  — generate a 6-digit code + session ID
//! - GET  /va/api/pair/status — poll for verification + receive auth token

use axum::{
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use axum::body::Body;

/// POST /va/api/pair/start — generate a pairing code.
///
/// Returns `{ "code": "847291", "sid": "uuid" }`.
/// The code expires in 1 minute.
pub async fn start_handler() -> Json<serde_json::Value> {
    let (sid, code) = common::auth::pair::generate();
    Json(serde_json::json!({
        "code": code,
        "sid": sid,
    }))
}

#[derive(serde::Deserialize)]
pub struct StatusQuery {
    sid: String,
}

/// Cookie name for the authenticated owner session.
const OWNER_COOKIE: &str = "va_owner";

/// GET /va/api/pair/status?sid={sid} — poll for pairing status.
///
/// Returns:
/// - `{ "status": "pending" }` — waiting for `/pair` command
/// - `{ "status": "expired" }` — code has expired, frontend should refresh
/// - `{ "status": "verified" }` — paired! Also sets `va_owner` cookie with auth token
pub async fn status_handler(Query(q): Query<StatusQuery>) -> Response {
    match common::auth::pair::check_status(&q.sid) {
        None => {
            // Unknown or expired session.
            Json(serde_json::json!({ "status": "expired" })).into_response()
        }
        Some(false) => {
            // Still pending.
            Json(serde_json::json!({ "status": "pending" })).into_response()
        }
        Some(true) => {
            // Verified! Consume the session and set the owner cookie.
            match common::auth::pair::consume_verified(&q.sid) {
                Some(token) => {
                    let cookie = format!(
                        "{}={}; Path=/va/; HttpOnly; SameSite=Lax",
                        OWNER_COOKIE, token
                    );
                    // Return the token in the body so the SPA can store it in
                    // sessionStorage (existing auth mechanism for API calls).
                    Response::builder()
                        .status(StatusCode::OK)
                        .header("Content-Type", "application/json")
                        .header("Set-Cookie", cookie)
                        .body(Body::from(
                            serde_json::json!({
                                "status": "verified",
                                "token": token,
                            })
                            .to_string(),
                        ))
                        .unwrap()
                }
                None => {
                    // Race: already consumed or token file missing.
                    Json(serde_json::json!({ "status": "expired" })).into_response()
                }
            }
        }
    }
}
