//! Codex model metadata bridge for provider models that Codex does not bundle.

use std::process::Command;
use std::sync::LazyLock;

use serde_json::{json, Value};

use super::catalog::ContentCapabilities;

pub struct CodexModelCatalogSpec<'a> {
    pub model: &'a str,
    pub provider_label: &'a str,
    pub context_window: u64,
    pub capabilities: &'a ContentCapabilities,
}

static BUNDLED_MODEL_TEMPLATE: LazyLock<Option<Value>> = LazyLock::new(load_bundled_model_template);

pub fn build_model_catalog_json(spec: CodexModelCatalogSpec<'_>) -> Option<String> {
    let mut model = BUNDLED_MODEL_TEMPLATE.as_ref()?.clone();
    let object = model.as_object_mut()?;
    object.insert("slug".to_string(), Value::String(spec.model.to_string()));
    object.insert(
        "display_name".to_string(),
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
    object.insert(
        "context_window".to_string(),
        Value::Number(spec.context_window.into()),
    );
    object.insert(
        "max_context_window".to_string(),
        Value::Number(spec.context_window.into()),
    );
    object.insert("input_modalities".to_string(), input_modalities(spec));
    serde_json::to_string_pretty(&json!({ "models": [model] })).ok()
}

fn input_modalities(spec: CodexModelCatalogSpec<'_>) -> Value {
    let mut modalities = vec![Value::String("text".to_string())];
    if spec.capabilities.image_input {
        modalities.push(Value::String("image".to_string()));
    }
    Value::Array(modalities)
}

fn load_bundled_model_template() -> Option<Value> {
    let output = Command::new("codex")
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
