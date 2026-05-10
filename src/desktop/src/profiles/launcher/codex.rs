//! Codex-specific launch arguments.

use std::path::{Path, PathBuf};

use ::common::{config, profiles};
use anyhow::{anyhow, bail, Context};
use profiles::ProfileDef;
use serde::Serialize;
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};

const CODEX_HOOKS_FEATURE_KEY: &str = "features.hooks";
const CODEX_SESSION_FLAGS_HOOK_SOURCE_UNIX: &str = "/<session-flags>/config.toml";
const CODEX_SESSION_FLAGS_HOOK_SOURCE_WINDOWS: &str = r"C:\<session-flags>\config.toml";
const CODEX_HOOK_TIMEOUT_SECS: u64 = 5;

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
    push_config_arg(&mut rendered.command_args, CODEX_HOOKS_FEATURE_KEY, "true");

    let session_start = CodexHookSpec::new(
        "session_start",
        Some("startup|resume|clear"),
        build_hook_command(
            &hook_helper,
            "SessionStart",
            launch_id,
            &profile.id,
            launch_target,
            &format!("http://127.0.0.1:{}", config::DEFAULT_PORT),
        ),
    );
    let user_prompt_submit = CodexHookSpec::new(
        "user_prompt_submit",
        None,
        build_hook_command(
            &hook_helper,
            "UserPromptSubmit",
            launch_id,
            &profile.id,
            launch_target,
            &format!("http://127.0.0.1:{}", config::DEFAULT_PORT),
        ),
    );
    let stop = CodexHookSpec::new(
        "stop",
        None,
        build_hook_command(
            &hook_helper,
            "Stop",
            launch_id,
            &profile.id,
            launch_target,
            &format!("http://127.0.0.1:{}", config::DEFAULT_PORT),
        ),
    );
    let hooks = [session_start, user_prompt_submit, stop];

    push_config_arg(
        &mut rendered.command_args,
        "hooks.SessionStart",
        &hook_config_value(hooks[0].matcher, &hooks[0].command),
    );
    push_config_arg(
        &mut rendered.command_args,
        "hooks.UserPromptSubmit",
        &hook_config_value(hooks[1].matcher, &hooks[1].command),
    );
    push_config_arg(
        &mut rendered.command_args,
        "hooks.Stop",
        &hook_config_value(hooks[2].matcher, &hooks[2].command),
    );
    push_config_arg(
        &mut rendered.command_args,
        "hooks.state",
        &trusted_hook_state_config_value(&hooks),
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
        "hooks = [{{ type = {}, command = {}, timeout = {CODEX_HOOK_TIMEOUT_SECS} }}]",
        toml_string("command"),
        toml_string(command)
    ));
    format!("[{{ {} }}]", fields.join(", "))
}

#[derive(Debug)]
struct CodexHookSpec {
    state_event_name: &'static str,
    matcher: Option<&'static str>,
    command: String,
}

impl CodexHookSpec {
    fn new(state_event_name: &'static str, matcher: Option<&'static str>, command: String) -> Self {
        Self {
            state_event_name,
            matcher,
            command,
        }
    }

    fn state_key(&self) -> String {
        format!(
            "{}:{}:0:0",
            session_flags_hook_source_path(),
            self.state_event_name
        )
    }

    fn trusted_hash(&self) -> String {
        command_hook_hash(self.state_event_name, self.matcher, &self.command)
    }
}

fn trusted_hook_state_config_value(hooks: &[CodexHookSpec]) -> String {
    let entries = hooks
        .iter()
        .map(|hook| {
            format!(
                "{} = {{ trusted_hash = {} }}",
                toml_string(&hook.state_key()),
                toml_string(&hook.trusted_hash())
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("{{ {entries} }}")
}

fn session_flags_hook_source_path() -> &'static str {
    if cfg!(target_os = "windows") {
        CODEX_SESSION_FLAGS_HOOK_SOURCE_WINDOWS
    } else {
        CODEX_SESSION_FLAGS_HOOK_SOURCE_UNIX
    }
}

#[derive(Serialize)]
struct NormalizedHookIdentity<'a> {
    event_name: &'a str,
    #[serde(flatten)]
    group: NormalizedMatcherGroup<'a>,
}

#[derive(Serialize)]
struct NormalizedMatcherGroup<'a> {
    matcher: Option<&'a str>,
    hooks: [NormalizedHookHandler<'a>; 1],
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum NormalizedHookHandler<'a> {
    #[serde(rename = "command")]
    Command {
        command: &'a str,
        #[serde(rename = "timeout")]
        timeout_sec: u64,
        #[serde(rename = "async")]
        r#async: bool,
        #[serde(rename = "statusMessage")]
        status_message: Option<&'a str>,
    },
}

fn command_hook_hash(event_name: &str, matcher: Option<&str>, command: &str) -> String {
    // Mirrors Codex's normalized hook identity hash so session-injected hooks
    // are trusted for the exact command VibeAround launches.
    let identity = NormalizedHookIdentity {
        event_name,
        group: NormalizedMatcherGroup {
            matcher,
            hooks: [NormalizedHookHandler::Command {
                command,
                timeout_sec: CODEX_HOOK_TIMEOUT_SECS,
                r#async: false,
                status_message: None,
            }],
        },
    };
    let value = toml::Value::try_from(identity)
        .expect("normalized Codex hook identity should serialize to TOML");
    version_for_toml(&value)
}

fn version_for_toml(value: &toml::Value) -> String {
    let json = serde_json::to_value(value).unwrap_or(JsonValue::Null);
    let canonical = canonical_json(&json);
    let serialized = serde_json::to_vec(&canonical).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(serialized);
    let hash = hasher.finalize();
    let hex = hash
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("sha256:{hex}")
}

fn canonical_json(value: &JsonValue) -> JsonValue {
    match value {
        JsonValue::Object(map) => {
            let mut sorted = serde_json::Map::new();
            let mut keys = map.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                if let Some(value) = map.get(&key) {
                    sorted.insert(key, canonical_json(value));
                }
            }
            JsonValue::Object(sorted)
        }
        JsonValue::Array(items) => JsonValue::Array(items.iter().map(canonical_json).collect()),
        other => other.clone(),
    }
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
    fn uses_current_hooks_feature_flag() {
        let mut args = Vec::new();
        push_config_arg(&mut args, CODEX_HOOKS_FEATURE_KEY, "true");

        assert_eq!(
            args,
            vec!["-c".to_string(), "features.hooks=true".to_string(),]
        );
        assert!(!args.iter().any(|arg| arg.contains("codex_hooks")));
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

    #[test]
    fn builds_trusted_hook_state_for_session_flags() {
        let hooks = [
            CodexHookSpec::new(
                "session_start",
                Some("startup|resume|clear"),
                "hook --agent codex --event SessionStart".to_string(),
            ),
            CodexHookSpec::new(
                "user_prompt_submit",
                None,
                "hook --agent codex --event UserPromptSubmit".to_string(),
            ),
            CodexHookSpec::new("stop", None, "hook --agent codex --event Stop".to_string()),
        ];

        let value = trusted_hook_state_config_value(&hooks);

        assert!(value.contains("trusted_hash = 'sha256:"));
        assert!(value.contains(&format!(
            "{}:session_start:0:0",
            session_flags_hook_source_path()
        )));
        assert!(value.contains(&format!(
            "{}:user_prompt_submit:0:0",
            session_flags_hook_source_path()
        )));
        assert!(value.contains(&format!("{}:stop:0:0", session_flags_hook_source_path())));
    }
}
