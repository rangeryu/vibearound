//! Codex-specific launch arguments.

use std::path::{Path, PathBuf};

use ::common::{config, profiles};
use anyhow::{anyhow, bail, Context};
use profiles::ProfileDef;

pub(super) fn apply_session_hooks(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
    rendered: &mut profiles::render::RenderedProfile,
) -> anyhow::Result<()> {
    if launch_target != "codex" {
        return Ok(());
    }

    let hook_helper = resolve_hook_helper_path()?;
    push_config_arg(&mut rendered.command_args, "features.codex_hooks", "true");

    let command_for = |event: &str| {
        build_hook_command(
            &hook_helper,
            event,
            launch_id,
            &profile.id,
            launch_target,
            &format!("http://127.0.0.1:{}", config::DEFAULT_PORT),
        )
    };
    push_config_arg(
        &mut rendered.command_args,
        "hooks.SessionStart",
        &hook_config_value(Some("startup|resume|clear"), &command_for("SessionStart")),
    );
    push_config_arg(
        &mut rendered.command_args,
        "hooks.UserPromptSubmit",
        &hook_config_value(None, &command_for("UserPromptSubmit")),
    );
    push_config_arg(
        &mut rendered.command_args,
        "hooks.Stop",
        &hook_config_value(None, &command_for("Stop")),
    );
    Ok(())
}

pub(super) fn push_config_arg(args: &mut Vec<String>, key: &str, value: &str) {
    args.push("-c".to_string());
    args.push(format!("{key}={value}"));
}

/// Wraps a value as a TOML literal string (`'...'`) when possible. Literal
/// strings avoid `"` characters in Codex `-c` arguments, which matters for
/// Windows PowerShell native-command argument passing.
pub(super) fn toml_string(s: &str) -> String {
    if !s.contains('\'') {
        return format!("'{s}'");
    }

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
}

fn hook_config_value(matcher: Option<&str>, command: &str) -> String {
    let mut fields = Vec::new();
    if let Some(matcher) = matcher {
        fields.push(format!("matcher = {}", toml_string(matcher)));
    }
    fields.push(format!(
        "hooks = [{{ type = {}, command = {}, timeout = 5 }}]",
        toml_string("command"),
        toml_string(command)
    ));
    format!("[{{ {} }}]", fields.join(", "))
}

fn build_hook_command(
    hook_helper: &Path,
    event: &str,
    launch_id: &str,
    profile_id: &str,
    launch_target: &str,
    server_url: &str,
) -> String {
    [
        quote_hook_arg(&hook_helper.to_string_lossy()),
        "--agent".to_string(),
        quote_hook_arg("codex"),
        "--event".to_string(),
        quote_hook_arg(event),
        "--launch-id".to_string(),
        quote_hook_arg(launch_id),
        "--profile-id".to_string(),
        quote_hook_arg(profile_id),
        "--launch-target".to_string(),
        quote_hook_arg(launch_target),
        "--server".to_string(),
        quote_hook_arg(server_url),
    ]
    .join(" ")
}

fn resolve_hook_helper_path() -> anyhow::Result<PathBuf> {
    let exe = std::env::current_exe().context("resolve current executable")?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| anyhow!("current executable has no parent: {:?}", exe))?;
    let sidecar_dir = if exe_dir.ends_with("deps") {
        exe_dir.parent().unwrap_or(exe_dir)
    } else {
        exe_dir
    };
    let candidate = sidecar_dir.join(hook_helper_name());
    if candidate.exists() {
        return Ok(candidate);
    }

    #[cfg(debug_assertions)]
    {
        let dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/debug")
            .join(hook_helper_name());
        if dev_candidate.exists() {
            return Ok(dev_candidate);
        }
    }

    bail!(
        "VibeAround hook helper not found next to executable: {:?}",
        candidate
    )
}

fn hook_helper_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "vibearound-hook.exe"
    } else {
        "vibearound-hook"
    }
}

#[cfg(not(target_os = "windows"))]
fn quote_hook_arg(value: &str) -> String {
    shell_escape::unix::escape(std::borrow::Cow::Borrowed(value)).into_owned()
}

#[cfg(target_os = "windows")]
fn quote_hook_arg(value: &str) -> String {
    let needs_quoting = value.is_empty()
        || value
            .chars()
            .any(|c| matches!(c, ' ' | '\t' | '"' | '&' | '|' | '<' | '>' | '^'));
    if needs_quoting {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_config_args() {
        let mut args = Vec::new();
        push_config_arg(
            &mut args,
            "model_providers.deepseek.base_url",
            &toml_string("http://127.0.0.1:12358/va/openai-proxy/deepseek/launch-123/v1"),
        );
        push_config_arg(
            &mut args,
            "model_providers.deepseek.wire_api",
            &toml_string("responses"),
        );

        assert_eq!(
            args,
            vec![
                "-c".to_string(),
                "model_providers.deepseek.base_url='http://127.0.0.1:12358/va/openai-proxy/deepseek/launch-123/v1'".to_string(),
                "-c".to_string(),
                "model_providers.deepseek.wire_api='responses'".to_string(),
            ]
        );
    }

    #[test]
    fn builds_hook_config_arg_value() {
        let command = build_hook_command(
            Path::new("/Applications/VibeAround.app/Contents/MacOS/vibearound-hook"),
            "SessionStart",
            "launch-123",
            "profile-456",
            "codex",
            "http://127.0.0.1:12358",
        );
        let value = hook_config_value(Some("startup|resume|clear"), &command);

        assert!(value.starts_with("[{ matcher = 'startup|resume|clear'"));
        assert!(value.contains("hooks = [{ type = 'command'"));
        assert!(value.contains("--launch-id"));
        assert!(value.contains("launch-123"));
        assert!(value.contains("--profile-id"));
        assert!(value.contains("profile-456"));
        assert!(value.ends_with(" }]"));
    }

    #[test]
    fn toml_string_falls_back_when_literal_cannot_represent_value() {
        assert_eq!(toml_string("plain"), "'plain'");
        assert_eq!(toml_string("team's"), "\"team's\"");
    }
}
