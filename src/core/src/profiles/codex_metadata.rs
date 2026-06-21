//! Codex model metadata bridge for provider models that Codex does not bundle.

use std::sync::LazyLock;

use serde_json::{json, Value};
use toml_edit::{Array as TomlArray, InlineTable, Value as TomlValue};

use super::catalog::ContentCapabilities;

pub struct CodexModelCatalogSpec<'a> {
    pub model: &'a str,
    pub provider_label: &'a str,
    pub context_window: Option<u64>,
    pub capabilities: &'a ContentCapabilities,
}

static BUNDLED_MODEL_TEMPLATE: LazyLock<Option<Value>> = LazyLock::new(load_bundled_model_template);

pub fn build_model_catalog_json(specs: &[CodexModelCatalogSpec<'_>]) -> Option<String> {
    let models: Vec<_> = specs.iter().filter_map(model_catalog_entry).collect();
    if models.is_empty() {
        return None;
    }
    serde_json::to_string_pretty(&json!({ "models": models })).ok()
}

fn model_catalog_entry(spec: &CodexModelCatalogSpec<'_>) -> Option<Value> {
    let mut model = BUNDLED_MODEL_TEMPLATE
        .as_ref()
        .cloned()
        .unwrap_or_else(fallback_model_template);
    let object = model.as_object_mut()?;
    object.insert("slug".to_string(), Value::String(spec.model.to_string()));
    object.insert("model".to_string(), Value::String(spec.model.to_string()));
    object.insert("id".to_string(), Value::String(spec.model.to_string()));
    object.insert(
        "display_name".to_string(),
        Value::String(spec.model.to_string()),
    );
    object.insert(
        "displayName".to_string(),
        Value::String(spec.model.to_string()),
    );
    object.insert(
        "description".to_string(),
        Value::String(format!("{} {}", spec.provider_label, spec.model)),
    );
    object.insert("availability_nux".to_string(), Value::Null);
    object.insert("upgrade".to_string(), Value::Null);
    object.insert(
        "additional_speed_tiers".to_string(),
        Value::Array(Vec::new()),
    );
    object.insert("service_tiers".to_string(), Value::Array(Vec::new()));
    let context_window = spec
        .context_window
        .map(|value| Value::Number(value.into()))
        .unwrap_or(Value::Null);
    object.insert("context_window".to_string(), context_window.clone());
    object.insert("contextWindow".to_string(), context_window.clone());
    object.insert("max_context_window".to_string(), context_window.clone());
    object.insert("maxContextWindow".to_string(), context_window);
    let input_modalities = input_modalities(spec);
    object.insert("input_modalities".to_string(), input_modalities.clone());
    object.insert("inputModalities".to_string(), input_modalities);
    object.insert(
        "supports_search_tool".to_string(),
        Value::Bool(spec.capabilities.web_search),
    );
    object.insert(
        "supportsSearchTool".to_string(),
        Value::Bool(spec.capabilities.web_search),
    );
    Some(model)
}

pub fn build_provider_models_toml(specs: &[CodexModelCatalogSpec<'_>]) -> Option<String> {
    let mut models = TomlArray::default();
    for spec in specs {
        let mut model = InlineTable::new();
        model.insert("model", TomlValue::from(spec.model));
        model.insert("id", TomlValue::from(spec.model));
        model.insert("display_name", TomlValue::from(spec.model));
        model.insert("displayName", TomlValue::from(spec.model));

        if let Some(context_window) = spec.context_window {
            let context_window = i64::try_from(context_window).unwrap_or(i64::MAX);
            model.insert("context_window", TomlValue::from(context_window));
            model.insert("contextWindow", TomlValue::from(context_window));
            model.insert("max_context_window", TomlValue::from(context_window));
            model.insert("maxContextWindow", TomlValue::from(context_window));
        }

        let modalities = toml_input_modalities(spec);
        model.insert("input_modalities", TomlValue::Array(modalities.clone()));
        model.insert("inputModalities", TomlValue::Array(modalities));
        model.insert(
            "supports_search_tool",
            TomlValue::from(spec.capabilities.web_search),
        );
        model.insert(
            "supportsSearchTool",
            TomlValue::from(spec.capabilities.web_search),
        );

        models.push(TomlValue::InlineTable(model));
    }

    if models.is_empty() {
        return None;
    }
    Some(TomlValue::Array(models).to_string())
}

fn input_modalities(spec: &CodexModelCatalogSpec<'_>) -> Value {
    let mut modalities = vec![Value::String("text".to_string())];
    if spec.capabilities.image_input {
        modalities.push(Value::String("image".to_string()));
    }
    if spec.capabilities.file_input {
        modalities.push(Value::String("file".to_string()));
    }
    Value::Array(modalities)
}

fn toml_input_modalities(spec: &CodexModelCatalogSpec<'_>) -> TomlArray {
    let mut modalities = TomlArray::default();
    modalities.push("text");
    if spec.capabilities.image_input {
        modalities.push("image");
    }
    if spec.capabilities.file_input {
        modalities.push("file");
    }
    modalities
}

fn load_bundled_model_template() -> Option<Value> {
    let output = crate::process::env::silent_std_command("codex")
        .args(["debug", "models", "--bundled"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let catalog: Value = serde_json::from_slice(&output.stdout).ok()?;
    let models = catalog.get("models")?.as_array()?;
    models
        .iter()
        .find(|model| model.get("slug").and_then(Value::as_str) == Some("gpt-5.5"))
        .or_else(|| models.first())
        .cloned()
}

fn fallback_model_template() -> Value {
    json!({
        "slug": "",
        "display_name": "",
        "description": null,
        "default_reasoning_level": null,
        "supported_reasoning_levels": [],
        "shell_type": "default",
        "visibility": "none",
        "supported_in_api": true,
        "priority": 99,
        "additional_speed_tiers": [],
        "service_tiers": [],
        "default_service_tier": null,
        "availability_nux": null,
        "upgrade": null,
        "base_instructions": "",
        "supports_reasoning_summaries": false,
        "default_reasoning_summary": "auto",
        "support_verbosity": false,
        "default_verbosity": null,
        "apply_patch_tool_type": null,
        "web_search_tool_type": "text",
        "truncation_policy": {
            "mode": "bytes",
            "limit": 10000
        },
        "supports_parallel_tool_calls": false,
        "supports_image_detail_original": false,
        "context_window": null,
        "max_context_window": null,
        "auto_compact_token_limit": null,
        "effective_context_window_percent": 95,
        "experimental_supported_tools": [],
        "input_modalities": ["text"],
        "supports_search_tool": false
    })
}
