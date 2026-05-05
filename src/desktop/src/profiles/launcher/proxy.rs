//! Profile proxy rendering decisions.

use ::common::{config, profiles};
use anyhow::{anyhow, bail};
use profiles::ProfileDef;

use super::codex;
use crate::profiles::terminal::{self, CompatibilityProxyMode, ProfileConnectionPreference};

pub(super) fn render_for_launch(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
) -> anyhow::Result<profiles::render::RenderedProfile> {
    match profile_connection(profile, launch_target) {
        Some(preference) if preference.proxy_enabled => {
            let target_api_type = preference
                .target_api_type
                .as_deref()
                .ok_or_else(|| anyhow!("proxy target is not configured"))?;
            render_proxy_launch(profile, launch_target, launch_id, target_api_type)
        }
        _ => render_runtime_launch(profile, launch_target, launch_id),
    }
}

fn render_runtime_launch(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
) -> anyhow::Result<profiles::render::RenderedProfile> {
    let mut rendered = profiles::runtime::render_for_launch(profile, launch_target)?;
    apply_compatibility_proxy(profile, launch_target, launch_id, &mut rendered)?;
    Ok(rendered)
}

fn apply_compatibility_proxy(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
    rendered: &mut profiles::render::RenderedProfile,
) -> anyhow::Result<()> {
    if terminal::read_compatibility_proxy_preference() == CompatibilityProxyMode::Off {
        return Ok(());
    }

    let provider = profiles::catalog::get(&profile.provider)
        .ok_or_else(|| anyhow!("unknown provider '{}'", profile.provider))?;
    let api_type = profiles::runtime::api_type_for_launch_target(profile, provider, launch_target)?;
    if launch_target != "codex" || api_type != "openai-chat" {
        return Ok(());
    }

    let provider_key = format!("model_providers.{}", profile.provider);
    let proxy_base_url = format!(
        "http://127.0.0.1:{}/va/openai-proxy/{}/{}/v1",
        config::DEFAULT_PORT,
        profile.id,
        launch_id
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

fn profile_connection(
    profile: &ProfileDef,
    launch_target: &str,
) -> Option<ProfileConnectionPreference> {
    terminal::read_profile_connections()
        .get(&profile.id)
        .and_then(|connections| connections.get(launch_target))
        .cloned()
}

fn render_proxy_launch(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
    target_api_type: &str,
) -> anyhow::Result<profiles::render::RenderedProfile> {
    let settings = resolve_proxy_settings(profile, target_api_type)?;
    match launch_target {
        "claude" => Ok(render_claude_proxy_profile(profile, launch_id, settings)),
        "codex" => Ok(render_codex_proxy_profile(profile, launch_id, settings)),
        other => bail!("proxy launch is not wired for '{}'", other),
    }
}

struct ProxyLaunchSettings {
    target_api_type: String,
    provider_label: String,
    api_key: String,
    model: String,
    reasoning_effort: String,
}

fn resolve_proxy_settings(
    profile: &ProfileDef,
    target_api_type: &str,
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

    let endpoint = provider
        .endpoints
        .iter()
        .find(|endpoint| endpoint.api_type == target_api_type)
        .ok_or_else(|| {
            anyhow!(
                "provider '{}' does not expose proxy target '{}'",
                profile.provider,
                target_api_type
            )
        })?;
    let api_key = profile
        .credentials
        .get("api_key")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("profile '{}' has no api_key credential", profile.id))?
        .clone();
    let model = profile
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
    let reasoning_effort = profile
        .overrides
        .get(target_api_type)
        .and_then(|overrides| overrides.reasoning_effort.clone())
        .unwrap_or_else(|| "medium".to_string());

    Ok(ProxyLaunchSettings {
        target_api_type: target_api_type.to_string(),
        provider_label: provider.label.clone(),
        api_key,
        model,
        reasoning_effort,
    })
}

fn render_claude_proxy_profile(
    profile: &ProfileDef,
    launch_id: &str,
    settings: ProxyLaunchSettings,
) -> profiles::render::RenderedProfile {
    let proxy_base_url = format!(
        "http://127.0.0.1:{}/va/proxy/{}/{}/{}",
        config::DEFAULT_PORT,
        profile.id,
        launch_id,
        settings.target_api_type
    );
    profiles::render::RenderedProfile {
        env: vec![
            ("ANTHROPIC_API_KEY".to_string(), settings.api_key),
            ("ANTHROPIC_BASE_URL".to_string(), proxy_base_url),
            ("ANTHROPIC_MODEL".to_string(), settings.model),
        ],
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
        "http://127.0.0.1:{}/va/proxy/{}/{}/{}/v1",
        config::DEFAULT_PORT,
        profile.id,
        launch_id,
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
        settings_files: Vec::new(),
        command_args,
        config_env: None,
    }
}

fn push_provider_config_arg(args: &mut Vec<String>, provider_key: &str, field: &str, value: &str) {
    codex::push_config_arg(args, &format!("{provider_key}.{field}"), value);
}
