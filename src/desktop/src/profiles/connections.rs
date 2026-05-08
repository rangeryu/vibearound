//! Profile-to-agent connection routing.
//!
//! This module owns the Launch tab's client API selection and local-proxy
//! routing decisions. Tauri commands validate and persist preferences; the
//! launcher consumes the resolved route.

use std::collections::BTreeMap;

use common::agent_state;
use common::profiles::ProfileDef;

use super::terminal;

pub(super) fn sanitize_profile_connection_preference(
    profile: &ProfileDef,
    agent_id: &str,
    preference: agent_state::ProfileConnectionPreference,
) -> Result<agent_state::ProfileConnectionPreference, String> {
    let supported = agent_client_api_types(agent_id);
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

pub(super) fn profile_can_launch_agent(profile: &ProfileDef, agent_id: &str) -> bool {
    resolve_profile_agent_route(profile, agent_id).is_some()
}

#[derive(Debug, Clone)]
pub(super) struct ProfileAgentRoute {
    pub client_api_type: String,
    pub proxy_target_api_type: Option<String>,
    pub proxy_upstream_model: Option<String>,
    pub proxy_fake_model_id: Option<String>,
}

pub(super) fn resolve_profile_agent_route(
    profile: &ProfileDef,
    agent_id: &str,
) -> Option<ProfileAgentRoute> {
    let supported = agent_client_api_types(agent_id);
    if supported.is_empty() {
        return None;
    }

    let connections = merged_profile_connections(&agent_state::read_prefs());
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

pub(super) fn merged_profile_connections(
    agent_prefs: &agent_state::AgentsPrefsFile,
) -> agent_state::ProfileConnectionPreferences {
    let mut out = legacy_profile_connections();
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

fn legacy_profile_connections() -> agent_state::ProfileConnectionPreferences {
    let legacy = terminal::read_profile_connections();
    let mut out = agent_state::ProfileConnectionPreferences::new();
    for (profile_id, by_agent) in legacy {
        let entry = out.entry(profile_id).or_default();
        for (agent_id, preference) in by_agent {
            let Some(selected_api_type) = default_client_api_type(&agent_id) else {
                continue;
            };
            let mut proxy = BTreeMap::new();
            if preference.proxy_enabled || preference.target_api_type.is_some() {
                proxy.insert(
                    selected_api_type.to_string(),
                    agent_state::ProfileProxyPreference {
                        enabled: preference.proxy_enabled,
                        target_api_type: preference.target_api_type,
                        upstream_model: None,
                        fake_model_id: None,
                        headers: BTreeMap::new(),
                    },
                );
            }
            entry.insert(
                agent_id,
                agent_state::ProfileConnectionPreference {
                    selected_api_type: Some(selected_api_type.to_string()),
                    proxy,
                },
            );
        }
    }
    out
}

fn default_client_api_type(agent_id: &str) -> Option<&'static str> {
    match agent_id {
        "claude" => Some("anthropic"),
        "codex" => Some("openai-responses"),
        "opencode" => Some("openai-responses"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use common::profiles::schema::{AuthMode, ProfileDef, ProviderSettings};

    use super::*;

    fn profile(api_types: &[&str]) -> ProfileDef {
        ProfileDef {
            id: "profile-test".to_string(),
            label: "Profile Test".to_string(),
            provider: "custom".to_string(),
            auth_mode: AuthMode::ApiKey,
            api_types: api_types.iter().map(|value| (*value).to_string()).collect(),
            credentials: BTreeMap::new(),
            overrides: BTreeMap::new(),
            provider_settings: ProviderSettings::default(),
        }
    }

    #[test]
    fn recommended_proxy_target_prefers_transforming_across_api_shapes() {
        let api_types = vec!["anthropic".to_string(), "openai-chat".to_string()];

        assert_eq!(
            recommended_proxy_target(&api_types, "codex", "openai-responses").as_deref(),
            Some("anthropic")
        );
        assert_eq!(
            recommended_proxy_target(&api_types, "claude", "anthropic").as_deref(),
            Some("openai-chat")
        );
    }

    #[test]
    fn sanitize_connection_trims_models_and_prunes_empty_proxy_entries() {
        let mut proxy = BTreeMap::new();
        proxy.insert(
            " anthropic ".to_string(),
            agent_state::ProfileProxyPreference {
                enabled: true,
                target_api_type: Some(" openai-chat ".to_string()),
                upstream_model: Some(" qwen3-coder-next ".to_string()),
                fake_model_id: Some(" ".to_string()),
                headers: [
                    (" Authorization ".to_string(), "Bearer custom".to_string()),
                    (" ".to_string(), "ignored".to_string()),
                ]
                .into_iter()
                .collect(),
            },
        );
        proxy.insert(
            " ".to_string(),
            agent_state::ProfileProxyPreference::default(),
        );

        let sanitized = sanitize_profile_connection_preference(
            &profile(&["openai-chat"]),
            "claude",
            agent_state::ProfileConnectionPreference {
                selected_api_type: Some(" anthropic ".to_string()),
                proxy,
            },
        )
        .expect("sanitize connection");

        assert_eq!(sanitized.selected_api_type.as_deref(), Some("anthropic"));
        let route = sanitized.proxy.get("anthropic").expect("proxy route");
        assert!(route.enabled);
        assert_eq!(route.target_api_type.as_deref(), Some("openai-chat"));
        assert_eq!(route.upstream_model.as_deref(), Some("qwen3-coder-next"));
        assert!(route.fake_model_id.is_none());
        assert_eq!(
            route.headers.get("Authorization").map(String::as_str),
            Some("Bearer custom")
        );
        assert!(!route.headers.contains_key(""));
        assert_eq!(sanitized.proxy.len(), 1);
    }
}
