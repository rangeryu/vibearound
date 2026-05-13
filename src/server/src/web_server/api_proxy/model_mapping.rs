use common::agent_state;
use common::profiles::{catalog, schema::ProfileDef};

#[derive(Debug, Clone)]
pub(super) struct ProxyModelMapping {
    pub(super) upstream_model: String,
    pub(super) agent_model: String,
}

pub(super) fn proxy_route_preference(
    profile: &ProfileDef,
    route_scope: Option<&str>,
    client_api_type: &str,
    target_api_type: &str,
) -> Option<agent_state::ProfileProxyPreference> {
    let agent_id = agent_id_from_scope(route_scope?, client_api_type)?;
    let prefs = agent_state::read_prefs();
    let preference = prefs.profile_connections.get(&profile.id)?.get(agent_id)?;
    let proxy = preference.proxy.get(client_api_type)?;
    if !proxy.enabled {
        return None;
    }
    let configured_target = proxy.target_api_type.as_deref().unwrap_or(target_api_type);
    if configured_target != target_api_type {
        return None;
    }
    Some(proxy.clone())
}

pub(super) fn proxy_model_mapping(
    profile: &ProfileDef,
    proxy: Option<&agent_state::ProfileProxyPreference>,
    target_api_type: &str,
) -> Option<ProxyModelMapping> {
    let proxy = proxy?;
    let requested_upstream_model = clean_model_id(proxy.upstream_model.as_deref())
        .or_else(|| default_model(profile, target_api_type))?;
    let upstream_model = canonical_model(profile, target_api_type, &requested_upstream_model)
        .unwrap_or_else(|| requested_upstream_model.clone());
    let agent_model =
        clean_model_id(proxy.fake_model_id.as_deref()).unwrap_or(requested_upstream_model);
    Some(ProxyModelMapping {
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
    fn proxy_mapping_canonicalizes_gemini_alias_for_upstream() {
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
        let proxy = agent_state::ProfileProxyPreference {
            enabled: true,
            target_api_type: Some("openai-chat".to_string()),
            upstream_model: Some("gemini-3.1-pro".to_string()),
            fake_model_id: None,
            headers: BTreeMap::new(),
        };

        let mapping = proxy_model_mapping(&profile, Some(&proxy), "openai-chat")
            .expect("mapping should resolve");

        assert_eq!(mapping.upstream_model, "gemini-3.1-pro-preview");
        assert_eq!(mapping.agent_model, "gemini-3.1-pro");
    }
}
