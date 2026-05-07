use common::profiles::schema::ProfileDef;
use serde_json::{json, Value};

#[derive(Debug, Clone)]
pub struct ZaiProxyAdapter {
    thinking_enabled: bool,
}

impl ZaiProxyAdapter {
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

        let thinking_enabled =
            thinking_from_original_request(original_request).unwrap_or(self.thinking_enabled);
        if !thinking_enabled {
            object.insert("thinking".to_string(), json!({ "type": "disabled" }));
        }
    }
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
    fn disables_zai_thinking_when_reasoning_is_off() {
        let profile = ProfileDef {
            id: "zai-test".to_string(),
            label: "Z.AI".to_string(),
            provider: "zai".to_string(),
            auth_mode: AuthMode::ApiKey,
            api_types: vec!["openai-chat".to_string()],
            credentials: Default::default(),
            overrides: Default::default(),
            provider_settings: Default::default(),
        };
        let mut adapter = ZaiProxyAdapter::new(&profile);
        let mut chat_request = json!({ "model": "glm-5.1", "messages": [] });

        adapter.prepare_chat_request(
            &json!({ "reasoning": { "effort": "none" } }),
            &mut chat_request,
        );

        assert_eq!(chat_request["thinking"], json!({ "type": "disabled" }));
    }

    #[test]
    fn leaves_zai_default_thinking_unpatched_when_enabled() {
        let profile = ProfileDef {
            id: "zai-test".to_string(),
            label: "Z.AI".to_string(),
            provider: "zai".to_string(),
            auth_mode: AuthMode::ApiKey,
            api_types: vec!["openai-chat".to_string()],
            credentials: Default::default(),
            overrides: Default::default(),
            provider_settings: Default::default(),
        };
        let mut adapter = ZaiProxyAdapter::new(&profile);
        let mut chat_request = json!({ "model": "glm-5.1", "messages": [] });

        adapter.prepare_chat_request(
            &json!({ "reasoning": { "effort": "high" } }),
            &mut chat_request,
        );

        assert!(chat_request.get("thinking").is_none());
    }
}
