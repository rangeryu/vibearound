//! Runtime settings API.

use axum::{http::StatusCode, Json};

/// GET /api/settings -- return raw settings.json.
pub async fn get_settings_handler() -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    common::config::read_settings_json()
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

/// PUT /api/settings -- replace settings.json with the supplied JSON object.
pub async fn put_settings_handler(
    Json(settings): Json<serde_json::Value>,
) -> Result<Json<crate::api_types::SettingsWriteResponse>, (StatusCode, String)> {
    if !settings.is_object() {
        return Err((
            StatusCode::BAD_REQUEST,
            "settings body must be a JSON object".to_string(),
        ));
    }

    common::config::write_settings_json(&settings)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    common::config::reload();

    Ok(Json(crate::api_types::SettingsWriteResponse { ok: true }))
}
