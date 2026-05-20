use common::agent_state;
use common::profiles::{catalog, schema::ProfileDef};

#[derive(Debug, Clone)]
pub(super) struct BridgeModelMapping {
    pub(super) upstream_model: String,
    pub(super) agent_model: String,
}

pub(super) fn bridge_route_preference(
    profile: &ProfileDef,
    route_scope: Option<&str>,
    client_api_type: &str,
    target_api_type: &str,
) -> Option<agent_state::ProfileBridgePreference> {
    let agent_id = agent_id_from_scope(route_scope?, client_api_type)?;
    let prefs = agent_state::read_prefs();
    let preference = prefs.profile_connections.get(&profile.id)?.get(agent_id)?;
    let bridge = preference.bridge.get(client_api_type)?;
    if !bridge.enabled {
        return None;
    }
    let configured_target = bridge.target_api_type.as_deref().unwrap_or(target_api_type);
    if configured_target != target_api_type {
        return None;
    }
    Some(bridge.clone())
}

pub(super) fn bridge_model_mapping(
    profile: &ProfileDef,
    bridge: Option<&agent_state::ProfileBridgePreference>,
    target_api_type: &str,
) -> Option<BridgeModelMapping> {
    let bridge = bridge?;
    let requested_upstream_model = clean_model_id(bridge.upstream_model.as_deref())
        .or_else(|| default_model(profile, target_api_type))?;
    let upstream_model = canonical_model(profile, target_api_type, &requested_upstream_model)
        .unwrap_or_else(|| requested_upstream_model.clone());
    let agent_model =
        clean_model_id(bridge.fake_model_id.as_deref()).unwrap_or(requested_upstream_model);
    Some(BridgeModelMapping {
        upstream_model,
        agent_model,
    })
}

fn agent_id_from_scope(scope: &str, client_api_type: &str) -> Option<&'static str> {
    for agent_id in ["claude", "codex", "gemini", "opencode"] {
        let prefix = format!("{agent_id}-");
        if scope.strip_prefix(&prefix) == Some(client_api_type) {
            return Some(agent_id);
        }
    }
    None
}

fn default_model(profile: &ProfileDef, target_api_type: &str) -> Option<String> {
    let provider = catalog::get(&profile.provider)?;
    let endpoint_id = profile
        .overrides
        .get(target_api_type)
        .and_then(|overrides| overrides.endpoint_id.as_deref());
    let endpoint = catalog::find_endpoint(provider, target_api_type, endpoint_id)?;
    profile
        .overrides
        .get(target_api_type)
        .and_then(|overrides| clean_model_id(overrides.model.as_deref()))
        .or_else(|| {
            endpoint
                .models
                .first()
                .and_then(|model| clean_model_id(Some(&model.id)))
        })
}

fn canonical_model(profile: &ProfileDef, target_api_type: &str, model: &str) -> Option<String> {
    let provider = catalog::get(&profile.provider)?;
    let endpoint_id = profile
        .overrides
        .get(target_api_type)
        .and_then(|overrides| overrides.endpoint_id.as_deref());
    let endpoint = catalog::find_endpoint(provider, target_api_type, endpoint_id)?;
    catalog::find_model(endpoint, model).map(|model_def| model_def.id.clone())
}

fn clean_model_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use common::profiles::schema::{ApiTypeOverrides, AuthMode};

    use super::*;

    #[test]
    fn bridge_mapping_canonicalizes_gemini_alias_for_upstream() {
        let profile = ProfileDef {
            id: "gemini-test".to_string(),
            label: "Gemini Test".to_string(),
            provider: "gemini".to_string(),
            auth_mode: AuthMode::ApiKey,
            api_types: vec!["openai-chat".to_string()],
            credentials: BTreeMap::new(),
            overrides: [(
                "openai-chat".to_string(),
                ApiTypeOverrides {
                    endpoint_id: Some("openai-compatible".to_string()),
                    base_url: None,
                    model: Some("gemini-3.1-pro".to_string()),
                    reasoning_effort: None,
                    capabilities: None,
                },
            )]
            .into_iter()
            .collect(),
            provider_settings: Default::default(),
        };
        let bridge = agent_state::ProfileBridgePreference {
            enabled: true,
            target_api_type: Some("openai-chat".to_string()),
            upstream_model: Some("gemini-3.1-pro".to_string()),
            fake_model_id: None,
            headers: BTreeMap::new(),
        };

        let mapping = bridge_model_mapping(&profile, Some(&bridge), "openai-chat")
            .expect("mapping should resolve");

        assert_eq!(mapping.upstream_model, "gemini-3.1-pro-preview");
        assert_eq!(mapping.agent_model, "gemini-3.1-pro");
    }
}
