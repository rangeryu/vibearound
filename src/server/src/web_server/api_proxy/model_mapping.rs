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
    let upstream_model = clean_model_id(proxy.upstream_model.as_deref())
        .or_else(|| default_model(profile, target_api_type))?;
    let agent_model =
        clean_model_id(proxy.fake_model_id.as_deref()).unwrap_or_else(|| upstream_model.clone());
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

fn clean_model_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}
