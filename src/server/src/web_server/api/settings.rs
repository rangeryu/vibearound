use std::collections::BTreeMap;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use common::config;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchToolSettingsResponse {
    enabled: bool,
    stdio_path: Option<String>,
    sources: BTreeMap<String, SearchSourceSettingsResponse>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSourceSettingsResponse {
    enabled: bool,
    has_api_key: bool,
    api_key_env: Option<String>,
    base_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSearchToolSettingsRequest {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    stdio_path: Option<Option<String>>,
    #[serde(default)]
    sources: BTreeMap<String, UpdateSearchSourceSettingsRequest>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSearchSourceSettingsRequest {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    api_key: Option<Option<String>>,
    #[serde(default)]
    api_key_env: Option<Option<String>>,
    #[serde(default)]
    base_url: Option<Option<String>>,
}

/// GET /api/settings/search-tool -- current host web search settings.
///
/// API keys are intentionally redacted; clients can set or clear them via PUT.
pub async fn get_search_tool_settings_handler() -> Json<SearchToolSettingsResponse> {
    Json(search_tool_settings_response())
}

/// PUT /api/settings/search-tool -- merge host web search settings into
/// settings.json. Omitted fields keep their current values.
pub async fn update_search_tool_settings_handler(
    Json(update): Json<UpdateSearchToolSettingsRequest>,
) -> Response {
    let result = config::update_settings_json(|root| {
        apply_search_tool_settings_update(root, update);
    });
    match result {
        Ok(()) => (StatusCode::OK, Json(search_tool_settings_response())).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": {
                    "message": error,
                    "type": "settings_write_error"
                }
            })),
        )
            .into_response(),
    }
}

fn search_tool_settings_response() -> SearchToolSettingsResponse {
    let cfg = config::ensure_loaded();
    SearchToolSettingsResponse {
        enabled: cfg.search_tool.enabled,
        stdio_path: cfg
            .search_tool
            .stdio_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        sources: cfg
            .search_tool
            .sources
            .iter()
            .map(|(name, source)| {
                (
                    name.clone(),
                    SearchSourceSettingsResponse {
                        enabled: source.enabled,
                        has_api_key: source.api_key.is_some(),
                        api_key_env: source.api_key_env.clone(),
                        base_url: source.base_url.clone(),
                    },
                )
            })
            .collect(),
    }
}

fn apply_search_tool_settings_update(root: &mut Value, update: UpdateSearchToolSettingsRequest) {
    let root = object_mut(root);
    root.remove("searchTool");
    let search_tool = object_entry(root, "search_tool");
    if let Some(enabled) = update.enabled {
        search_tool.insert("enabled".to_string(), json!(enabled));
    }
    if let Some(stdio_path) = update.stdio_path {
        set_optional_string(search_tool, "stdio_path", stdio_path);
    }

    if !update.sources.is_empty() {
        let sources = object_entry(search_tool, "sources");
        for (source_name, source_update) in update.sources {
            let Some(source_name) = normalize_source_name(&source_name) else {
                continue;
            };
            let source = object_entry(sources, &source_name);
            if let Some(enabled) = source_update.enabled {
                source.insert("enabled".to_string(), json!(enabled));
            }
            if let Some(api_key) = source_update.api_key {
                set_optional_string(source, "api_key", api_key);
            }
            if let Some(api_key_env) = source_update.api_key_env {
                set_optional_string(source, "api_key_env", api_key_env);
            }
            if let Some(base_url) = source_update.base_url {
                set_optional_string(source, "base_url", base_url);
            }
        }
    }
}

fn object_mut(value: &mut Value) -> &mut serde_json::Map<String, Value> {
    if !value.is_object() {
        *value = json!({});
    }
    value.as_object_mut().expect("value is object")
}

fn object_entry<'a>(
    object: &'a mut serde_json::Map<String, Value>,
    key: &str,
) -> &'a mut serde_json::Map<String, Value> {
    let value = object.entry(key.to_string()).or_insert_with(|| json!({}));
    object_mut(value)
}

fn set_optional_string(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<String>,
) {
    match value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            object.insert(key.to_string(), json!(value));
        }
        None => {
            object.remove(key);
        }
    }
}

fn normalize_source_name(name: &str) -> Option<String> {
    let name = name.trim().to_ascii_lowercase();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_tool_update_preserves_omitted_keys_and_clears_explicit_nulls() {
        let mut root = json!({
            "searchTool": { "enabled": true },
            "search_tool": {
                "enabled": false,
                "sources": {
                    "exa": {
                        "enabled": true,
                        "api_key": "existing-exa-key",
                        "api_key_env": "EXA_API_KEY"
                    },
                    "tavily": {
                        "enabled": true,
                        "api_key": "existing-tavily-key"
                    }
                }
            }
        });

        apply_search_tool_settings_update(
            &mut root,
            UpdateSearchToolSettingsRequest {
                enabled: Some(true),
                stdio_path: Some(Some(" ~/bin/va-search-tool ".to_string())),
                sources: BTreeMap::from([
                    (
                        "Exa".to_string(),
                        UpdateSearchSourceSettingsRequest {
                            enabled: Some(false),
                            api_key: None,
                            api_key_env: Some(None),
                            base_url: Some(Some(" https://api.exa.ai ".to_string())),
                        },
                    ),
                    (
                        "tavily".to_string(),
                        UpdateSearchSourceSettingsRequest {
                            api_key: Some(None),
                            ..UpdateSearchSourceSettingsRequest::default()
                        },
                    ),
                ]),
            },
        );

        assert!(root.get("searchTool").is_none());
        assert_eq!(root["search_tool"]["enabled"], json!(true));
        assert_eq!(
            root["search_tool"]["stdio_path"],
            json!("~/bin/va-search-tool")
        );
        assert_eq!(
            root["search_tool"]["sources"]["exa"]["enabled"],
            json!(false)
        );
        assert_eq!(
            root["search_tool"]["sources"]["exa"]["api_key"],
            json!("existing-exa-key")
        );
        assert!(root["search_tool"]["sources"]["exa"]
            .get("api_key_env")
            .is_none());
        assert_eq!(
            root["search_tool"]["sources"]["exa"]["base_url"],
            json!("https://api.exa.ai")
        );
        assert!(root["search_tool"]["sources"]["tavily"]
            .get("api_key")
            .is_none());
    }
}
