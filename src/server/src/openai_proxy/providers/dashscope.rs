use common::profiles::schema::ProfileDef;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct DashScopeProxyAdapter {
    thinking_enabled: bool,
}

impl DashScopeProxyAdapter {
    pub fn new(profile: &ProfileDef) -> Self {
        let thinking_enabled = profile
            .overrides
            .get("openai-chat")
            .and_then(|overrides| overrides.reasoning_effort.as_deref())
            .map(reasoning_effort_enabled)
            .unwrap_or(true);
        Self { thinking_enabled }
    }

    pub fn prepare_chat_request(&mut self, original_request: &Value, chat_request: &mut Value) {
        let Some(object) = chat_request.as_object_mut() else {
            return;
        };

        object.remove("reasoning");
        object.remove("reasoning_effort");
        object.remove("reasoningEffort");

        let Some(model) = object.get("model").and_then(Value::as_str) else {
            return;
        };
        if !model_uses_dashscope_enable_thinking(model) {
            return;
        }

        let enabled =
            thinking_from_original_request(original_request).unwrap_or(self.thinking_enabled);
        object.insert("enable_thinking".to_string(), Value::Bool(enabled));
    }
}

fn model_uses_dashscope_enable_thinking(model: &str) -> bool {
    let model = model.trim().to_ascii_lowercase();
    model.starts_with("qwen3.5")
        || model.starts_with("qwen3.6")
        || model.starts_with("qwen3-max")
        || matches!(
            model.as_str(),
            "glm-5" | "glm-4.7" | "kimi-k2.5" | "minimax-m2.5" | "minimax-m2.5-highspeed"
        )
}

fn thinking_from_original_request(request: &Value) -> Option<bool> {
    request
        .get("reasoning")
        .and_then(|reasoning| {
            reasoning
                .get("effort")
                .or_else(|| reasoning.get("reasoning_effort"))
                .or_else(|| reasoning.get("reasoningEffort"))
                .and_then(Value::as_str)
        })
        .or_else(|| request.get("reasoning_effort").and_then(Value::as_str))
        .or_else(|| request.get("reasoningEffort").and_then(Value::as_str))
        .map(reasoning_effort_enabled)
}

fn reasoning_effort_enabled(value: &str) -> bool {
    !matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "off" | "none" | "disabled" | "disable" | "false"
    )
}

#[cfg(test)]
mod tests {
    use common::profiles::schema::{AuthMode, ProfileDef};
    use serde_json::json;

    use super::*;

    #[test]
    fn maps_reasoning_effort_to_dashscope_enable_thinking_for_reasoning_models() {
        let profile = ProfileDef {
            id: "qwen-test".to_string(),
            label: "Alibaba DashScope".to_string(),
            provider: "dashscope".to_string(),
            auth_mode: AuthMode::ApiKey,
            api_types: vec!["openai-chat".to_string()],
            credentials: Default::default(),
            overrides: Default::default(),
            provider_settings: Default::default(),
        };
        let mut adapter = DashScopeProxyAdapter::new(&profile);
        let mut chat_request = json!({ "model": "qwen3.5-plus", "messages": [] });

        adapter.prepare_chat_request(
            &json!({ "reasoning": { "effort": "none" } }),
            &mut chat_request,
        );

        assert_eq!(chat_request["enable_thinking"], false);
    }

    #[test]
    fn leaves_non_reasoning_qwen_models_without_enable_thinking() {
        let profile = ProfileDef {
            id: "qwen-test".to_string(),
            label: "Alibaba DashScope".to_string(),
            provider: "dashscope".to_string(),
            auth_mode: AuthMode::ApiKey,
            api_types: vec!["openai-chat".to_string()],
            credentials: Default::default(),
            overrides: Default::default(),
            provider_settings: Default::default(),
        };
        let mut adapter = DashScopeProxyAdapter::new(&profile);
        let mut chat_request = json!({ "model": "qwen3-coder-plus", "messages": [] });

        adapter.prepare_chat_request(
            &json!({ "reasoning": { "effort": "high" } }),
            &mut chat_request,
        );

        assert!(chat_request.get("enable_thinking").is_none());
    }

    #[test]
    fn maps_reasoning_effort_to_dashscope_partner_reasoning_models() {
        let profile = ProfileDef {
            id: "qwen-test".to_string(),
            label: "Alibaba DashScope".to_string(),
            provider: "dashscope".to_string(),
            auth_mode: AuthMode::ApiKey,
            api_types: vec!["openai-chat".to_string()],
            credentials: Default::default(),
            overrides: Default::default(),
            provider_settings: Default::default(),
        };
        let mut adapter = DashScopeProxyAdapter::new(&profile);
        let mut chat_request = json!({ "model": "glm-5", "messages": [] });

        adapter.prepare_chat_request(
            &json!({ "reasoning": { "effort": "high" } }),
            &mut chat_request,
        );

        assert_eq!(chat_request["enable_thinking"], true);
    }
}
