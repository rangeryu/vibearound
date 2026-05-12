//! Proxy profile rendering for route-aware launches.

use anyhow::{anyhow, bail};
use serde_json::{json, Map, Value};

use super::catalog;
use super::render::{ConfigEnvTarget, RenderedProfile, RenderedSettingsFile};
use super::schema::ProfileDef;
use crate::config;

pub(super) fn render_proxy_launch(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
    client_api_type: &str,
    target_api_type: &str,
    upstream_model: Option<&str>,
    fake_model_id: Option<&str>,
) -> anyhow::Result<RenderedProfile> {
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
    reasoning_effort: String,
}

fn resolve_proxy_settings(
    profile: &ProfileDef,
    target_api_type: &str,
    upstream_model: Option<&str>,
    fake_model_id: Option<&str>,
) -> anyhow::Result<ProxyLaunchSettings> {
    let provider = catalog::get(&profile.provider)
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
    let endpoint =
        catalog::find_endpoint(provider, target_api_type, endpoint_id).ok_or_else(|| {
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
        reasoning_effort,
    })
}

fn render_claude_proxy_profile(
    profile: &ProfileDef,
    _launch_id: &str,
    settings: ProxyLaunchSettings,
) -> RenderedProfile {
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
    RenderedProfile {
        env,
        settings_files: Vec::new(),
        command_args: Vec::new(),
        config_env: None,
    }
}

fn render_codex_proxy_profile(
    profile: &ProfileDef,
    _launch_id: &str,
    settings: ProxyLaunchSettings,
) -> RenderedProfile {
    let proxy_base_url = format!(
        "http://127.0.0.1:{}/va/local-api/{}/{}/{}/v1",
        config::DEFAULT_PORT,
        profile.id,
        settings.scope,
        settings.target_api_type
    );
    let provider_key = format!("model_providers.{}", profile.provider);
    let mut command_args = Vec::new();

    push_config_arg(&mut command_args, "model", &toml_string(&settings.model));
    push_config_arg(
        &mut command_args,
        "model_provider",
        &toml_string(&profile.provider),
    );
    push_config_arg(
        &mut command_args,
        "model_reasoning_effort",
        &toml_string(&settings.reasoning_effort),
    );
    push_provider_config_arg(
        &mut command_args,
        &provider_key,
        "name",
        &toml_string(&settings.provider_label),
    );
    push_provider_config_arg(
        &mut command_args,
        &provider_key,
        "base_url",
        &toml_string(&proxy_base_url),
    );
    push_provider_config_arg(
        &mut command_args,
        &provider_key,
        "wire_api",
        &toml_string("responses"),
    );
    push_provider_config_arg(
        &mut command_args,
        &provider_key,
        "env_key",
        &toml_string("OPENAI_API_KEY"),
    );
    push_provider_config_arg(
        &mut command_args,
        &provider_key,
        "requires_openai_auth",
        "true",
    );

    RenderedProfile {
        env: vec![("OPENAI_API_KEY".to_string(), settings.api_key)],
        settings_files: Vec::new(),
        command_args,
        config_env: None,
    }
}

fn render_opencode_proxy_profile(
    profile: &ProfileDef,
    _launch_id: &str,
    client_api_type: &str,
    settings: ProxyLaunchSettings,
) -> RenderedProfile {
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

    RenderedProfile {
        env: vec![("VIBEAROUND_OPENCODE_API_KEY".to_string(), settings.api_key)],
        settings_files: vec![RenderedSettingsFile {
            rel_path: "opencode.json".to_string(),
            contents: serde_json::to_string_pretty(&config).unwrap_or_else(|_| "{}".to_string()),
        }],
        command_args: Vec::new(),
        config_env: Some(ConfigEnvTarget::File {
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

fn push_config_arg(args: &mut Vec<String>, key: &str, value: &str) {
    args.push("-c".to_string());
    args.push(format!("{key}={value}"));
}

fn push_provider_config_arg(args: &mut Vec<String>, provider_key: &str, field: &str, value: &str) {
    push_config_arg(args, &format!("{provider_key}.{field}"), value);
}

fn toml_string(s: &str) -> String {
    if s.contains('\'') {
        let mut out = String::with_capacity(s.len() + 2);
        out.push('"');
        for ch in s.chars() {
            match ch {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                other => out.push(other),
            }
        }
        out.push('"');
        out
    } else {
        let mut out = String::with_capacity(s.len() + 2);
        out.push('\'');
        out.push_str(s);
        out.push('\'');
        out
    }
}
