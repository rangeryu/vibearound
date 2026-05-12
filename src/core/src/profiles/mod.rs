//! Shared profile runtime.
//!
//! Profiles are user-managed provider credentials plus the catalog metadata
//! needed to render env vars and profile-local config files for coding CLIs.
//! Desktop owns the UI and terminal window launch; core owns the reusable
//! schema/catalog/rendering path so IM-started agents can use the same
//! profiles.

pub mod catalog;
pub mod connections;
pub mod headers;
mod proxy_launch;
pub mod render;
pub mod runtime;
pub mod schema;

pub use schema::{AuthMode, ProfileDef};

const DASHSCOPE_PROVIDER_ID: &str = "dashscope";
const DASHSCOPE_LABEL: &str = "Alibaba DashScope";
const LEGACY_QWEN_PROVIDER_ID: &str = "qwen";
const LEGACY_QWEN_LABEL: &str = "Qwen / DashScope";

pub fn normalize_legacy_profile(mut profile: ProfileDef) -> ProfileDef {
    normalize_legacy_dashscope_profile(&mut profile);

    if profile.provider == "azure" && profile.api_types.iter().any(|t| t == "openai-chat") {
        let chat_overrides = profile.overrides.remove("openai-chat");
        profile.api_types.retain(|t| t != "openai-chat");
        if !profile.api_types.iter().any(|t| t == "openai-responses") {
            profile.api_types.push("openai-responses".to_string());
            if let Some(overrides) = chat_overrides {
                profile
                    .overrides
                    .entry("openai-responses".to_string())
                    .or_insert(overrides);
            }
        }
    }
    profile
}

pub fn normalize_legacy_profile_and_persist(profile: ProfileDef) -> ProfileDef {
    let should_persist_dashscope_migration = needs_dashscope_profile_persist(&profile);
    let profile = normalize_legacy_profile(profile);

    // TODO(0.6.x): remove this qwen -> dashscope migration patch once old
    // profile files have had a release window to be rewritten on load.
    if should_persist_dashscope_migration {
        if let Err(error) = schema::save(&profile) {
            tracing::warn!(
                "[profiles] failed to persist legacy qwen profile migration for '{}': {}",
                profile.id,
                error
            );
        }
    }

    profile
}

fn normalize_legacy_dashscope_profile(profile: &mut ProfileDef) {
    if profile.provider == LEGACY_QWEN_PROVIDER_ID {
        profile.provider = DASHSCOPE_PROVIDER_ID.to_string();
    }
    if profile.provider != DASHSCOPE_PROVIDER_ID {
        return;
    }

    if profile.label == LEGACY_QWEN_LABEL {
        profile.label = DASHSCOPE_LABEL.to_string();
    }

    for overrides in profile.overrides.values_mut() {
        let Some(endpoint_id) = overrides.endpoint_id.as_deref() else {
            continue;
        };
        let next = match endpoint_id {
            "coding-global" => "coding-plan",
            "coding-cn" => "coding-plan-cn",
            "standard-global" => "token-plan",
            "standard-cn" => "token-plan-cn",
            _ => continue,
        };
        overrides.endpoint_id = Some(next.to_string());
    }
}

fn needs_dashscope_profile_persist(profile: &ProfileDef) -> bool {
    profile.provider == LEGACY_QWEN_PROVIDER_ID
        || (profile.provider == DASHSCOPE_PROVIDER_ID
            && (profile.label == LEGACY_QWEN_LABEL
                || profile.overrides.values().any(|overrides| {
                    matches!(
                        overrides.endpoint_id.as_deref(),
                        Some("coding-global" | "coding-cn" | "standard-global" | "standard-cn")
                    )
                })))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use schema::{ApiTypeOverrides, AuthMode, ProviderSettings};

    #[test]
    fn normalizes_legacy_qwen_provider_and_endpoint_ids() {
        let mut overrides = BTreeMap::new();
        overrides.insert(
            "openai-chat".to_string(),
            ApiTypeOverrides {
                endpoint_id: Some("standard-cn".to_string()),
                base_url: None,
                model: None,
                reasoning_effort: None,
                capabilities: None,
            },
        );
        let profile = ProfileDef {
            id: "qwen-old".to_string(),
            label: LEGACY_QWEN_LABEL.to_string(),
            provider: "qwen".to_string(),
            auth_mode: AuthMode::ApiKey,
            api_types: vec!["openai-chat".to_string()],
            credentials: BTreeMap::new(),
            overrides,
            provider_settings: ProviderSettings::default(),
        };

        let profile = normalize_legacy_profile(profile);

        assert_eq!(profile.provider, "dashscope");
        assert_eq!(profile.label, DASHSCOPE_LABEL);
        assert_eq!(
            profile
                .overrides
                .get("openai-chat")
                .and_then(|overrides| overrides.endpoint_id.as_deref()),
            Some("token-plan-cn")
        );
    }

    #[test]
    fn preserves_custom_legacy_qwen_profile_label() {
        let profile = ProfileDef {
            id: "qwen-custom".to_string(),
            label: "Work DashScope".to_string(),
            provider: "qwen".to_string(),
            auth_mode: AuthMode::ApiKey,
            api_types: vec!["openai-chat".to_string()],
            credentials: BTreeMap::new(),
            overrides: BTreeMap::new(),
            provider_settings: ProviderSettings::default(),
        };

        let profile = normalize_legacy_profile(profile);

        assert_eq!(profile.provider, "dashscope");
        assert_eq!(profile.label, "Work DashScope");
    }
}
