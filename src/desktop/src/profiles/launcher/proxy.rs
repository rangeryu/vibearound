//! Profile proxy rendering decisions.

use ::common::{config, profiles};
use anyhow::{anyhow, bail};
use profiles::codex_metadata::{self, CodexModelCatalogSpec};
use profiles::ProfileDef;
use serde_json::{json, Map, Value};

use super::codex;
use crate::profiles::terminal::{self, CompatibilityProxyMode};

pub(super) fn render_for_launch(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
) -> anyhow::Result<profiles::render::RenderedProfile> {
    let route = crate::profiles::resolve_profile_agent_route(profile, launch_target)
        .ok_or_else(|| anyhow!("profile '{}' cannot launch '{}'", profile.id, launch_target))?;
    match route.proxy_target_api_type {
        Some(target_api_type) => render_proxy_launch(
            profile,
            launch_target,
            launch_id,
            &route.client_api_type,
            &target_api_type,
            route.proxy_upstream_model.as_deref(),
            route.proxy_fake_model_id.as_deref(),
        ),
        None => render_runtime_launch(profile, launch_target, launch_id, &route.client_api_type),
    }
}

fn render_runtime_launch(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
    client_api_type: &str,
) -> anyhow::Result<profiles::render::RenderedProfile> {
    let mut rendered =
        profiles::runtime::render_for_launch_api_type(profile, launch_target, client_api_type)?;
    apply_compatibility_proxy(
        profile,
        launch_target,
        launch_id,
        client_api_type,
        &mut rendered,
    )?;
    Ok(rendered)
}

fn apply_compatibility_proxy(
    profile: &ProfileDef,
    launch_target: &str,
    _launch_id: &str,
    api_type: &str,
    rendered: &mut profiles::render::RenderedProfile,
) -> anyhow::Result<()> {
    if terminal::read_compatibility_proxy_preference() == CompatibilityProxyMode::Off {
        return Ok(());
    }

    if launch_target != "codex" || api_type != "openai-chat" {
        return Ok(());
    }

    let provider_key = format!("model_providers.{}", profile.provider);
    let proxy_base_url = format!(
        "http://127.0.0.1:{}/va/local-api/{}/codex-openai-chat/openai-chat/v1",
        config::DEFAULT_PORT,
        profile.id
    );

    codex::push_config_arg(
        &mut rendered.command_args,
        &format!("{provider_key}.base_url"),
        &codex::toml_string(&proxy_base_url),
    );
    codex::push_config_arg(
        &mut rendered.command_args,
        &format!("{provider_key}.wire_api"),
        &codex::toml_string("responses"),
    );

    Ok(())
}

fn render_proxy_launch(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
    client_api_type: &str,
    target_api_type: &str,
    upstream_model: Option<&str>,
    fake_model_id: Option<&str>,
) -> anyhow::Result<profiles::render::RenderedProfile> {
    let mut settings =
        resolve_proxy_settings(profile, target_api_type, upstream_model, fake_model_id)?;
    settings.scope = format!("{launch_target}-{client_api_type}");
    match launch_target {
        "claude" => Ok(render_claude_proxy_profile(profile, launch_id, settings)),
        "codex" => Ok(render_codex_proxy_profile(profile, launch_id, settings)),
        "opencode" => Ok(render_opencode_proxy_profile(
            profile,
            launch_id,
            client_api_type,
            settings,
        )),
        other => bail!("proxy launch is not wired for '{}'", other),
    }
}

struct ProxyLaunchSettings {
    target_api_type: String,
    scope: String,
    provider_label: String,
    api_key: String,
    model: String,
    model_context_window: Option<u64>,
    model_capabilities: profiles::catalog::ContentCapabilities,
    reasoning_effort: String,
}

fn resolve_proxy_settings(
    profile: &ProfileDef,
    target_api_type: &str,
    upstream_model: Option<&str>,
    fake_model_id: Option<&str>,
) -> anyhow::Result<ProxyLaunchSettings> {
    let provider = profiles::catalog::get(&profile.provider)
        .ok_or_else(|| anyhow!("unknown provider '{}'", profile.provider))?;
    if !profile
        .api_types
        .iter()
        .any(|api_type| api_type == target_api_type)
    {
        bail!(
            "profile '{}' does not expose proxy target '{}'",
            profile.id,
            target_api_type
        );
    }

    let endpoint_id = profile
        .overrides
        .get(target_api_type)
        .and_then(|overrides| overrides.endpoint_id.as_deref());
    let endpoint = profiles::catalog::find_endpoint(provider, target_api_type, endpoint_id)
        .ok_or_else(|| {
            let suffix = endpoint_id
                .map(|id| format!(" endpoint_id '{id}'"))
                .unwrap_or_default();
            anyhow!(
                "provider '{}' does not expose proxy target '{}'{}",
                profile.provider,
                target_api_type,
                suffix
            )
        })?;
    let api_key = profile
        .credentials
        .get("api_key")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("profile '{}' has no api_key credential", profile.id))?
        .clone();
    let profile_model = profile
        .overrides
        .get(target_api_type)
        .and_then(|overrides| overrides.model.clone())
        .or_else(|| endpoint.models.first().map(|model| model.id.clone()))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            anyhow!(
                "profile '{}' has no model configured for proxy target '{}'",
                profile.id,
                target_api_type
            )
        })?;
    let upstream_model = upstream_model
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or(profile_model);
    let model_def = endpoint
        .models
        .iter()
        .find(|model_def| model_def.id == upstream_model);
    let model_context_window = model_def.and_then(|model_def| model_def.context_window);
    let model_capabilities = model_def
        .map(|model_def| endpoint.capabilities.content.merge(&model_def.capabilities))
        .unwrap_or_else(|| endpoint.capabilities.content.clone());
    let model = fake_model_id
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| upstream_model.clone());
    let reasoning_effort = profile
        .overrides
        .get(target_api_type)
        .and_then(|overrides| overrides.reasoning_effort.clone())
        .unwrap_or_else(|| "medium".to_string());

    Ok(ProxyLaunchSettings {
        target_api_type: target_api_type.to_string(),
        scope: String::new(),
        provider_label: provider.label.clone(),
        api_key,
        model,
        model_context_window,
        model_capabilities,
        reasoning_effort,
    })
}

fn render_claude_proxy_profile(
    profile: &ProfileDef,
    _launch_id: &str,
    settings: ProxyLaunchSettings,
) -> profiles::render::RenderedProfile {
    let proxy_base_url = format!(
        "http://127.0.0.1:{}/va/local-api/{}/{}/{}",
        config::DEFAULT_PORT,
        profile.id,
        settings.scope,
        settings.target_api_type
    );
    let mut env = vec![
        ("ANTHROPIC_API_KEY".to_string(), settings.api_key.clone()),
        ("ANTHROPIC_AUTH_TOKEN".to_string(), settings.api_key),
        ("ANTHROPIC_BASE_URL".to_string(), proxy_base_url),
        ("ANTHROPIC_MODEL".to_string(), settings.model.clone()),
    ];
    if profile.provider == "deepseek" {
        env.extend([
            (
                "ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(),
                settings.model.clone(),
            ),
            (
                "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
                settings.model.clone(),
            ),
            (
                "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
                "deepseek-v4-flash".to_string(),
            ),
            (
                "CLAUDE_CODE_SUBAGENT_MODEL".to_string(),
                "deepseek-v4-flash".to_string(),
            ),
            ("CLAUDE_CODE_EFFORT_LEVEL".to_string(), "max".to_string()),
        ]);
    }
    profiles::render::RenderedProfile {
        env,
        settings_files: Vec::new(),
        command_args: Vec::new(),
        config_env: None,
    }
}

fn render_codex_proxy_profile(
    profile: &ProfileDef,
    launch_id: &str,
    settings: ProxyLaunchSettings,
) -> profiles::render::RenderedProfile {
    let proxy_base_url = format!(
        "http://127.0.0.1:{}/va/local-api/{}/{}/{}/v1",
        config::DEFAULT_PORT,
        profile.id,
        settings.scope,
        settings.target_api_type
    );
    let provider_key = format!("model_providers.{}", profile.provider);
    let mut command_args = Vec::new();

    codex::push_config_arg(
        &mut command_args,
        "model",
        &codex::toml_string(&settings.model),
    );
    codex::push_config_arg(
        &mut command_args,
        "model_provider",
        &codex::toml_string(&profile.provider),
    );
    codex::push_config_arg(
        &mut command_args,
        "model_reasoning_effort",
        &codex::toml_string(&settings.reasoning_effort),
    );
    let mut settings_files = Vec::new();
    if let Some(context_window) = settings.model_context_window {
        codex::push_config_arg(
            &mut command_args,
            "model_context_window",
            &context_window.to_string(),
        );
        if let Some(model_catalog_json) =
            codex_metadata::build_model_catalog_json(CodexModelCatalogSpec {
                model: &settings.model,
                provider_label: &settings.provider_label,
                context_window,
                capabilities: &settings.model_capabilities,
            })
        {
            let rel_path = format!("codex-model-catalog-{launch_id}.json");
            let catalog_path = profiles::runtime::profile_state_dir(&profile.id).join(&rel_path);
            let catalog_path = catalog_path.to_string_lossy();
            codex::push_config_arg(
                &mut command_args,
                "model_catalog_json",
                &codex::toml_string(catalog_path.as_ref()),
            );
            settings_files.push(profiles::render::RenderedSettingsFile {
                rel_path,
                contents: model_catalog_json,
            });
        }
    }
    push_provider_config_arg(
        &mut command_args,
        &provider_key,
        "name",
        &codex::toml_string(&settings.provider_label),
    );
    push_provider_config_arg(
        &mut command_args,
        &provider_key,
        "base_url",
        &codex::toml_string(&proxy_base_url),
    );
    push_provider_config_arg(
        &mut command_args,
        &provider_key,
        "wire_api",
        &codex::toml_string("responses"),
    );
    push_provider_config_arg(
        &mut command_args,
        &provider_key,
        "env_key",
        &codex::toml_string("OPENAI_API_KEY"),
    );
    push_provider_config_arg(
        &mut command_args,
        &provider_key,
        "requires_openai_auth",
        "true",
    );

    profiles::render::RenderedProfile {
        env: vec![("OPENAI_API_KEY".to_string(), settings.api_key)],
        settings_files,
        command_args,
        config_env: None,
    }
}

fn render_opencode_proxy_profile(
    profile: &ProfileDef,
    _launch_id: &str,
    client_api_type: &str,
    settings: ProxyLaunchSettings,
) -> profiles::render::RenderedProfile {
    let proxy_base_url = opencode_proxy_base_url(profile, &settings, client_api_type);
    let npm = match client_api_type {
        "anthropic" => "@ai-sdk/anthropic",
        "openai-chat" => "@ai-sdk/openai-compatible",
        _ => "@ai-sdk/openai",
    };
    let provider_id = profile.provider.clone();
    let model = settings.model.clone();
    let mut models = Map::new();
    models.insert(model.clone(), json!({ "name": model }));
    let mut providers = Map::new();
    providers.insert(
        provider_id.clone(),
        json!({
            "npm": npm,
            "name": settings.provider_label,
            "options": {
                "baseURL": proxy_base_url,
                "apiKey": "{env:VIBEAROUND_OPENCODE_API_KEY}",
                "setCacheKey": true
            },
            "models": Value::Object(models)
        }),
    );
    let config = json!({
        "$schema": "https://opencode.ai/config.json",
        "model": format!("{}/{}", provider_id, settings.model),
        "provider": Value::Object(providers)
    });

    profiles::render::RenderedProfile {
        env: vec![("VIBEAROUND_OPENCODE_API_KEY".to_string(), settings.api_key)],
        settings_files: vec![profiles::render::RenderedSettingsFile {
            rel_path: "opencode.json".to_string(),
            contents: serde_json::to_string_pretty(&config).unwrap_or_else(|_| "{}".to_string()),
        }],
        command_args: Vec::new(),
        config_env: Some(profiles::render::ConfigEnvTarget::File {
            env: "OPENCODE_CONFIG",
            rel_path: "opencode.json",
        }),
    }
}

fn opencode_proxy_base_url(
    profile: &ProfileDef,
    settings: &ProxyLaunchSettings,
    client_api_type: &str,
) -> String {
    let suffix = if client_api_type == "anthropic" {
        ""
    } else {
        "/v1"
    };
    format!(
        "http://127.0.0.1:{}/va/local-api/{}/{}/{}{}",
        config::DEFAULT_PORT,
        profile.id,
        settings.scope,
        settings.target_api_type,
        suffix
    )
}

fn push_provider_config_arg(args: &mut Vec<String>, provider_key: &str, field: &str, value: &str) {
    codex::push_config_arg(args, &format!("{provider_key}.{field}"), value);
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use ::common::profiles::schema::ApiTypeOverrides;
    use ::common::profiles::{AuthMode, ProfileDef};

    use super::*;

    #[test]
    fn codex_proxy_launch_includes_catalog_context_window() {
        let profile = dashscope_profile();

        let rendered = render_proxy_launch(
            &profile,
            "codex",
            "launch-test",
            "openai-responses",
            "openai-chat",
            Some("qwen3.6-plus"),
            None,
        )
        .expect("codex proxy launch renders");

        assert!(rendered
            .command_args
            .iter()
            .any(|arg| arg == "model='qwen3.6-plus'"));
        assert!(rendered
            .command_args
            .iter()
            .any(|arg| arg == "model_context_window=1000000"));
    }

    fn dashscope_profile() -> ProfileDef {
        let mut credentials = BTreeMap::new();
        credentials.insert("api_key".to_string(), "test-key".to_string());

        let mut overrides = BTreeMap::new();
        overrides.insert(
            "openai-chat".to_string(),
            ApiTypeOverrides {
                endpoint_id: Some("coding-plan".to_string()),
                base_url: None,
                model: Some("qwen3.6-plus".to_string()),
                reasoning_effort: Some("medium".to_string()),
                capabilities: None,
            },
        );

        ProfileDef {
            id: "dashscope-test".to_string(),
            label: "DashScope Test".to_string(),
            provider: "dashscope".to_string(),
            auth_mode: AuthMode::ApiKey,
            api_types: vec!["openai-chat".to_string()],
            credentials,
            overrides,
            provider_settings: Default::default(),
        }
    }
}
