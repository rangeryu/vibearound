//! Profile-to-agent connection routing shared by desktop launch and web
//! terminal launch.
//!
//! A profile's raw `api_types` tell us which provider protocols it exposes.
//! A launch target also depends on per-profile agent preferences: which client
//! protocol the agent should speak and whether VibeAround should proxy that
//! client protocol to another provider protocol.

use std::collections::BTreeMap;

use crate::agent_state;

mod legacy;

use super::schema::ProfileDef;

#[derive(Debug, Clone)]
pub struct ProfileAgentRoute {
    pub client_api_type: String,
    pub proxy_target_api_type: Option<String>,
    pub proxy_upstream_model: Option<String>,
    pub proxy_fake_model_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProfileLaunchTarget {
    pub id: &'static str,
    pub label: &'static str,
    pub api_type: String,
    pub proxy_target_api_type: Option<String>,
}

pub fn sanitize_profile_connection_preference(
    profile: &ProfileDef,
    agent_id: &str,
    preference: agent_state::ProfileConnectionPreference,
) -> Result<agent_state::ProfileConnectionPreference, String> {
    let supported = agent_client_api_types(agent_id);
    if supported.is_empty() {
        return Err(format!("unsupported connection target: '{}'", agent_id));
    }
    let selected_api_type = preference
        .selected_api_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| recommended_client_api_type(profile, agent_id).unwrap_or(supported[0]));
    if !supported.contains(&selected_api_type) {
        return Err(format!(
            "{} does not support api kind '{}'",
            agent_id, selected_api_type
        ));
    }

    let mut proxy = BTreeMap::new();
    for (client_api_type, proxy_preference) in preference.proxy {
        let client_api_type = client_api_type.trim().to_string();
        if client_api_type.is_empty() {
            continue;
        }
        if !supported.contains(&client_api_type.as_str()) {
            return Err(format!(
                "{} does not support api kind '{}'",
                agent_id, client_api_type
            ));
        }
        let target_api_type = proxy_preference
            .target_api_type
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let target_api_type = if proxy_preference.enabled {
            let target_api_type = target_api_type.or_else(|| {
                recommended_proxy_target(&profile.api_types, agent_id, &client_api_type)
            });
            let target_api_type = target_api_type.ok_or_else(|| {
                format!(
                    "profile '{}' has no API kind that can be used as a proxy target",
                    profile.id
                )
            })?;
            validate_proxy_target(profile, &target_api_type)?;
            Some(target_api_type)
        } else {
            target_api_type.filter(|api_type| validate_proxy_target(profile, api_type).is_ok())
        };
        let upstream_model = proxy_preference
            .upstream_model
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let fake_model_id = proxy_preference
            .fake_model_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let headers = if proxy_preference.enabled {
            prune_proxy_headers(proxy_preference.headers)
        } else {
            BTreeMap::new()
        };
        if proxy_preference.enabled
            || target_api_type.is_some()
            || upstream_model.is_some()
            || fake_model_id.is_some()
            || !headers.is_empty()
        {
            proxy.insert(
                client_api_type,
                agent_state::ProfileProxyPreference {
                    enabled: proxy_preference.enabled,
                    target_api_type,
                    upstream_model,
                    fake_model_id,
                    headers,
                },
            );
        }
    }

    Ok(agent_state::ProfileConnectionPreference {
        selected_api_type: Some(selected_api_type.to_string()),
        proxy,
    })
}

pub fn profile_can_launch_agent(profile: &ProfileDef, agent_id: &str) -> bool {
    resolve_profile_agent_route(profile, agent_id).is_some()
}

pub fn resolve_profile_agent_route(
    profile: &ProfileDef,
    agent_id: &str,
) -> Option<ProfileAgentRoute> {
    let connections = merged_profile_connections(&agent_state::read_prefs());
    resolve_profile_agent_route_with_connections(profile, agent_id, &connections)
}

pub fn resolve_profile_agent_route_with_connections(
    profile: &ProfileDef,
    agent_id: &str,
    connections: &agent_state::ProfileConnectionPreferences,
) -> Option<ProfileAgentRoute> {
    let supported = agent_client_api_types(agent_id);
    if supported.is_empty() {
        return None;
    }

    let preference = connections
        .get(&profile.id)
        .and_then(|items| items.get(agent_id));
    let preferred_client_api_type = preference
        .and_then(|preference| preference.selected_api_type.as_deref())
        .filter(|api_type| supported.contains(api_type))
        .filter(|api_type| client_route_available(profile, agent_id, preference, api_type))
        .map(ToString::to_string);
    let client_api_type = preferred_client_api_type
        .or_else(|| recommended_client_api_type(profile, agent_id).map(ToString::to_string))?;

    let proxy_preference = preference.and_then(|preference| preference.proxy.get(&client_api_type));
    if let Some(proxy_preference) = proxy_preference.filter(|proxy| proxy.enabled) {
        let target_api_type = proxy_preference
            .target_api_type
            .clone()
            .or_else(|| recommended_proxy_target(&profile.api_types, agent_id, &client_api_type))?;
        if validate_proxy_target(profile, &target_api_type).is_ok() {
            return Some(ProfileAgentRoute {
                client_api_type,
                proxy_target_api_type: Some(target_api_type),
                proxy_upstream_model: proxy_preference.upstream_model.clone(),
                proxy_fake_model_id: proxy_preference.fake_model_id.clone(),
            });
        }
    }

    if profile
        .api_types
        .iter()
        .any(|api_type| api_type == &client_api_type)
    {
        return Some(ProfileAgentRoute {
            client_api_type,
            proxy_target_api_type: None,
            proxy_upstream_model: None,
            proxy_fake_model_id: None,
        });
    }

    None
}

pub fn launch_targets_for_profile(profile: &ProfileDef) -> Vec<ProfileLaunchTarget> {
    let connections = merged_profile_connections(&agent_state::read_prefs());
    launch_targets_for_profile_with_connections(profile, &connections)
}

pub fn launch_targets_for_profile_with_connections(
    profile: &ProfileDef,
    connections: &agent_state::ProfileConnectionPreferences,
) -> Vec<ProfileLaunchTarget> {
    launch_target_defs()
        .iter()
        .filter_map(|(agent_id, label)| {
            let agent_id = *agent_id;
            let label = *label;
            let route =
                resolve_profile_agent_route_with_connections(profile, agent_id, connections)?;
            Some(ProfileLaunchTarget {
                id: agent_id,
                label,
                api_type: route.client_api_type,
                proxy_target_api_type: route.proxy_target_api_type,
            })
        })
        .collect()
}

pub fn merged_profile_connections(
    agent_prefs: &agent_state::AgentsPrefsFile,
) -> agent_state::ProfileConnectionPreferences {
    let mut out = legacy::profile_connections();
    for (profile_id, by_agent) in &agent_prefs.profile_connections {
        let entry = out.entry(profile_id.clone()).or_default();
        for (agent_id, preference) in by_agent {
            entry.insert(agent_id.clone(), preference.clone());
        }
    }
    out
}

fn client_route_available(
    profile: &ProfileDef,
    agent_id: &str,
    preference: Option<&agent_state::ProfileConnectionPreference>,
    client_api_type: &str,
) -> bool {
    if profile
        .api_types
        .iter()
        .any(|api_type| api_type == client_api_type)
    {
        return true;
    }
    let Some(proxy_preference) =
        preference.and_then(|preference| preference.proxy.get(client_api_type))
    else {
        return false;
    };
    if !proxy_preference.enabled {
        return false;
    }
    let Some(target_api_type) = proxy_preference
        .target_api_type
        .clone()
        .or_else(|| recommended_proxy_target(&profile.api_types, agent_id, client_api_type))
    else {
        return false;
    };
    validate_proxy_target(profile, &target_api_type).is_ok()
}

fn is_proxy_target_api_type(api_type: &str) -> bool {
    matches!(api_type, "anthropic" | "openai-responses" | "openai-chat")
}

fn recommended_proxy_target(
    api_types: &[String],
    agent_id: &str,
    client_api_type: &str,
) -> Option<String> {
    let order: &[&str] = match (agent_id, client_api_type) {
        ("claude", "anthropic") | ("opencode", "anthropic") => {
            &["openai-responses", "openai-chat", "anthropic"]
        }
        ("codex", "openai-responses")
        | ("opencode", "openai-responses")
        | ("opencode", "openai-chat") => &["anthropic", "openai-chat", "openai-responses"],
        ("gemini", "gemini") => &["openai-chat", "openai-responses", "anthropic"],
        _ => &[],
    };
    order
        .iter()
        .find(|candidate| api_types.iter().any(|api_type| api_type == *candidate))
        .map(|candidate| (*candidate).to_string())
}

fn validate_proxy_target(profile: &ProfileDef, target_api_type: &str) -> Result<(), String> {
    if !profile
        .api_types
        .iter()
        .any(|api_type| api_type == target_api_type)
    {
        return Err(format!(
            "profile '{}' does not expose api kind '{}'",
            profile.id, target_api_type
        ));
    }
    if !is_proxy_target_api_type(target_api_type) {
        return Err(format!(
            "api kind '{}' cannot be used as a proxy target",
            target_api_type
        ));
    }
    Ok(())
}

fn prune_proxy_headers(headers: BTreeMap<String, String>) -> BTreeMap<String, String> {
    headers
        .into_iter()
        .filter_map(|(name, value)| {
            let name = name.trim().to_string();
            (!name.is_empty()).then_some((name, value))
        })
        .collect()
}

fn agent_client_api_types(agent_id: &str) -> &'static [&'static str] {
    match agent_id {
        "claude" => &["anthropic"],
        "codex" => &["openai-responses"],
        "gemini" => &["gemini"],
        "opencode" => &["openai-responses", "openai-chat", "anthropic"],
        _ => &[],
    }
}

fn recommended_client_api_type(profile: &ProfileDef, agent_id: &str) -> Option<&'static str> {
    agent_client_api_types(agent_id)
        .iter()
        .find(|api_type| profile.api_types.iter().any(|value| value == *api_type))
        .copied()
        .or_else(|| agent_client_api_types(agent_id).first().copied())
}

fn launch_target_defs() -> &'static [(&'static str, &'static str)] {
    &[
        ("claude", "Claude Code"),
        ("codex", "Codex"),
        ("gemini", "Gemini CLI"),
        ("opencode", "OpenCode"),
    ]
}

#[cfg(test)]
mod tests;
