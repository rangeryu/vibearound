//! Terminal launcher — write a one-shot bash script with the rendered env
//! exports and `exec` into the right CLI, then ask Terminal.app to open it.
//!
//! VibeAround does not track the spawned terminal: once the user has the
//! window, the CLI is theirs. This module is fire-and-forget by design.
//!
//! # Security
//!
//! - Env values, cwd paths, and CLI args are escaped by the target shell's
//!   rules before being interpolated into the launch script. The script itself
//!   is written 0600 and self-deletes on its first line so a `cat` between
//!   spawn and exec is a narrow race window.
//! - The script path passed to AppleScript is escaped against AppleScript
//!   string semantics (a separate ruleset from POSIX shell quoting); the
//!   two are not interchangeable.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context};

#[cfg(target_os = "windows")]
use common::auth;
use common::{config, profiles, resources};

use super::terminal::{self, TerminalChoice};
use profiles::ProfileDef;

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

pub fn launch(profile: &ProfileDef, launch_target: &str) -> anyhow::Result<()> {
    let launch_id = uuid::Uuid::new_v4().to_string();
    let mut rendered = match proxy_preference(profile, launch_target) {
        Some(preference) if preference.proxy_enabled => {
            let target_api_type = preference
                .target_api_type
                .as_deref()
                .ok_or_else(|| anyhow!("proxy target is not configured"))?;
            render_proxy_launch(profile, launch_target, &launch_id, target_api_type)?
        }
        _ => {
            let mut rendered = profiles::runtime::render_for_launch(profile, launch_target)?;
            apply_compatibility_proxy(profile, launch_target, &launch_id, &mut rendered)?;
            rendered
        }
    };
    apply_codex_session_hooks(profile, launch_target, &launch_id, &mut rendered)?;
    do_launch(profile, launch_target, &launch_id, rendered)
}

/// "Direct" launch — open a Terminal running the named coding CLI with NO
/// env at all. The CLI uses whatever global OAuth / login / config it has
/// on disk (`~/.claude/`, `~/.codex/`, `~/.gemini/`, etc.), so VibeAround
/// stays out of the credential business entirely. `agent_id` matches the
/// `id` field in `agents.json`.
pub fn launch_direct(agent_id: &str) -> anyhow::Result<()> {
    let agent = resources::agent_by_id(agent_id)
        .ok_or_else(|| anyhow!("agent '{}' not found in agents.json", agent_id))?;
    let workspace = terminal::resolve_workspace_preference()?;
    spawn_terminal(
        &[],
        &agent.pty.command,
        &[],
        &format!("{} (direct)", agent.display_name),
        &workspace,
    )
}

fn do_launch(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
    rendered: profiles::render::RenderedProfile,
) -> anyhow::Result<()> {
    let command_args = rendered.command_args.clone();
    let mut env = profiles::runtime::materialize_env(&profile.id, rendered)?;
    env.push(("VIBEAROUND_LAUNCH_ID".to_string(), launch_id.to_string()));
    env.push(("VIBEAROUND_PROFILE_ID".to_string(), profile.id.clone()));
    env.push((
        "VIBEAROUND_LAUNCH_TARGET".to_string(),
        launch_target.to_string(),
    ));
    let agent_id = profiles::runtime::agent_id_for(launch_target)?;
    let agent = resources::agent_by_id(agent_id)
        .ok_or_else(|| anyhow!("agent '{}' not found in agents.json", agent_id))?;
    let workspace = terminal::resolve_workspace_preference()?;

    spawn_terminal(
        &env,
        &agent.pty.command,
        &command_args,
        &profile.label,
        &workspace,
    )?;
    Ok(())
}

fn apply_codex_session_hooks(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
    rendered: &mut profiles::render::RenderedProfile,
) -> anyhow::Result<()> {
    if launch_target != "codex" {
        return Ok(());
    }

    let hook_helper = resolve_hook_helper_path()?;
    push_codex_config_arg(&mut rendered.command_args, "features.codex_hooks", "true");

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
    push_codex_config_arg(
        &mut rendered.command_args,
        "hooks.SessionStart",
        &codex_hook_config_value(Some("startup|resume|clear"), &command_for("SessionStart")),
    );
    push_codex_config_arg(
        &mut rendered.command_args,
        "hooks.UserPromptSubmit",
        &codex_hook_config_value(None, &command_for("UserPromptSubmit")),
    );
    push_codex_config_arg(
        &mut rendered.command_args,
        "hooks.Stop",
        &codex_hook_config_value(None, &command_for("Stop")),
    );
    Ok(())
}

fn command_with_unix_args(command: &str, args: &[String]) -> String {
    if args.is_empty() {
        return command.to_string();
    }

    let mut out = command.to_string();
    for arg in args {
        out.push(' ');
        out.push_str(&shell_escape::unix::escape(std::borrow::Cow::Borrowed(
            arg.as_str(),
        )));
    }
    out
}

fn apply_compatibility_proxy(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
    rendered: &mut profiles::render::RenderedProfile,
) -> anyhow::Result<()> {
    let mode = terminal::read_compatibility_proxy_preference();
    if mode == terminal::CompatibilityProxyMode::Off {
        return Ok(());
    }

    let provider = profiles::catalog::get(&profile.provider)
        .ok_or_else(|| anyhow!("unknown provider '{}'", profile.provider))?;
    let api_type = profiles::runtime::api_type_for_launch_target(profile, provider, launch_target)?;

    if api_type != "openai-chat" || launch_target != "codex" {
        return Ok(());
    }

    let proxy_base_url = format!(
        "http://127.0.0.1:{}/va/openai-proxy/{}/{}/v1",
        config::DEFAULT_PORT,
        profile.id,
        launch_id
    );

    let provider_key = format!("model_providers.{}", profile.provider);
    push_codex_config_arg(
        &mut rendered.command_args,
        &format!("{provider_key}.base_url"),
        &toml_basic_string(&proxy_base_url),
    );
    push_codex_config_arg(
        &mut rendered.command_args,
        &format!("{provider_key}.wire_api"),
        &toml_basic_string("responses"),
    );

    Ok(())
}

fn proxy_preference(
    profile: &ProfileDef,
    launch_target: &str,
) -> Option<terminal::ProfileConnectionPreference> {
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

    match launch_target {
        "claude" => {
            render_claude_proxy_profile(profile, launch_id, target_api_type, api_key, model)
        }
        "codex" => render_codex_proxy_profile(
            profile,
            provider.label.as_str(),
            launch_id,
            target_api_type,
            api_key,
            model,
            reasoning_effort,
        ),
        other => bail!("proxy launch is not wired for '{}'", other),
    }
}

fn render_claude_proxy_profile(
    profile: &ProfileDef,
    launch_id: &str,
    target_api_type: &str,
    api_key: String,
    model: String,
) -> anyhow::Result<profiles::render::RenderedProfile> {
    let proxy_base_url = format!(
        "http://127.0.0.1:{}/va/proxy/{}/{}/{}",
        config::DEFAULT_PORT,
        profile.id,
        launch_id,
        target_api_type
    );
    Ok(profiles::render::RenderedProfile {
        env: vec![
            ("ANTHROPIC_API_KEY".to_string(), api_key),
            ("ANTHROPIC_BASE_URL".to_string(), proxy_base_url),
            ("ANTHROPIC_MODEL".to_string(), model),
        ],
        settings_files: Vec::new(),
        command_args: Vec::new(),
        config_env: None,
    })
}

fn render_codex_proxy_profile(
    profile: &ProfileDef,
    provider_label: &str,
    launch_id: &str,
    target_api_type: &str,
    api_key: String,
    model: String,
    reasoning_effort: String,
) -> anyhow::Result<profiles::render::RenderedProfile> {
    let proxy_base_url = format!(
        "http://127.0.0.1:{}/va/proxy/{}/{}/{}/v1",
        config::DEFAULT_PORT,
        profile.id,
        launch_id,
        target_api_type
    );
    let mut command_args = Vec::new();
    let provider_key = format!("model_providers.{}", profile.provider);
    push_codex_config_arg(&mut command_args, "model", &toml_basic_string(&model));
    push_codex_config_arg(
        &mut command_args,
        "model_provider",
        &toml_basic_string(&profile.provider),
    );
    push_codex_config_arg(
        &mut command_args,
        "model_reasoning_effort",
        &toml_basic_string(&reasoning_effort),
    );
    push_codex_config_arg(
        &mut command_args,
        &format!("{provider_key}.name"),
        &toml_basic_string(provider_label),
    );
    push_codex_config_arg(
        &mut command_args,
        &format!("{provider_key}.base_url"),
        &toml_basic_string(&proxy_base_url),
    );
    push_codex_config_arg(
        &mut command_args,
        &format!("{provider_key}.wire_api"),
        &toml_basic_string("responses"),
    );
    push_codex_config_arg(
        &mut command_args,
        &format!("{provider_key}.env_key"),
        &toml_basic_string("OPENAI_API_KEY"),
    );
    push_codex_config_arg(
        &mut command_args,
        &format!("{provider_key}.requires_openai_auth"),
        "true",
    );

    Ok(profiles::render::RenderedProfile {
        env: vec![("OPENAI_API_KEY".to_string(), api_key)],
        settings_files: Vec::new(),
        command_args,
        config_env: None,
    })
}

fn push_codex_config_arg(args: &mut Vec<String>, key: &str, value: &str) {
    args.push("-c".to_string());
    args.push(format!("{key}={value}"));
}

fn codex_hook_config_value(matcher: Option<&str>, command: &str) -> String {
    let mut fields = Vec::new();
    if let Some(matcher) = matcher {
        fields.push(format!("matcher = {}", toml_basic_string(matcher)));
    }
    fields.push(format!(
        "hooks = [{{ type = \"command\", command = {}, timeout = 5 }}]",
        toml_basic_string(command)
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
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn toml_basic_string(s: &str) -> String {
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

// ---------------------------------------------------------------------------
// macOS Terminal spawn
// ---------------------------------------------------------------------------
//
// We hand the rendered bash script to `open -a <Terminal.app>` rather than
// driving Terminal/iTerm via osascript. `open` goes through LaunchServices,
// which is a normal user-initiated action — no Automation TCC permission
// prompt, no dance through System Settings → Privacy & Security. The
// `.command` extension is the canonical macOS marker for "executable shell
// script that opens a terminal window when launched"; both Terminal.app and
// iTerm2 register as handlers for it.

#[cfg(target_os = "macos")]
fn spawn_terminal(
    env: &[(String, String)],
    command: &str,
    args: &[String],
    window_label: &str,
    workspace: &Path,
) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let script = build_bash_script(env, command, args, window_label, workspace);
    let script_path = std::env::temp_dir().join(format!(
        "vibearound-launch-{}.command",
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&script_path, &script)
        .with_context(|| format!("write launch script {:?}", script_path))?;
    std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o700))
        .with_context(|| format!("chmod launch script {:?}", script_path))?;

    let choice = terminal::read_preference();
    let app_name = match choice {
        TerminalChoice::Terminal => "Terminal",
        TerminalChoice::Iterm2 => "iTerm",
        other => bail!("terminal '{}' is not supported on macOS", other.id()),
    };

    let status = std::process::Command::new("open")
        .arg("-a")
        .arg(app_name)
        .arg(&script_path)
        .status()
        .with_context(|| format!("invoke `open -a {}`", app_name))?;

    if !status.success() {
        // The script self-deletes on its first line; only nuke it ourselves
        // if `open` never even launched a terminal that could run it.
        let _ = std::fs::remove_file(&script_path);
        bail!(
            "`open -a {}` failed (exit {:?}). Make sure {0}.app is installed and try again.",
            app_name,
            status.code()
        );
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[cfg(not(target_os = "windows"))]
fn spawn_terminal(
    _env: &[(String, String)],
    _command: &str,
    _args: &[String],
    _window_label: &str,
    _workspace: &Path,
) -> anyhow::Result<()> {
    bail!("Profile launch is only supported on macOS and Windows");
}

// ---------------------------------------------------------------------------
// Windows terminal spawn
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn spawn_terminal(
    env: &[(String, String)],
    command: &str,
    args: &[String],
    window_label: &str,
    workspace: &Path,
) -> anyhow::Result<()> {
    let choice = terminal::read_preference();
    let script_path =
        write_windows_launch_script(env, command, args, window_label, choice, workspace)?;
    let title = format!("VibeAround - {}", window_label);

    let params = match choice {
        TerminalChoice::PowerShell => format!(
            "/C start {} powershell.exe -ExecutionPolicy Bypass -NoExit -File {}",
            quote_cmd_arg(&title),
            quote_cmd_arg(&script_path.to_string_lossy())
        ),
        TerminalChoice::Cmd => format!(
            "/C start {} cmd.exe /K {}",
            quote_cmd_arg(&title),
            quote_cmd_arg(&script_path.to_string_lossy())
        ),
        other => bail!("terminal '{}' is not supported on Windows", other.id()),
    };

    // Use ShellExecuteW through the `open` crate instead of Rust `Command`.
    // `Command` inherits all inheritable handles by default on Windows; if a
    // launched CLI keeps the daemon's TCP listener handle alive, VibeAround's
    // next start sees 127.0.0.1:12358 as occupied by a stale PID.
    open::with(params, "cmd.exe").with_context(|| format!("open {}", choice.label()))?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn write_windows_launch_script(
    env: &[(String, String)],
    command: &str,
    args: &[String],
    window_label: &str,
    choice: TerminalChoice,
    workspace: &Path,
) -> anyhow::Result<PathBuf> {
    let (command, args) = normalize_windows_launch_command(command, args);
    let script_path = match choice {
        TerminalChoice::PowerShell => {
            std::env::temp_dir().join(format!("vibearound-launch-{}.ps1", uuid::Uuid::new_v4()))
        }
        TerminalChoice::Cmd => {
            std::env::temp_dir().join(format!("vibearound-launch-{}.cmd", uuid::Uuid::new_v4()))
        }
        other => bail!("terminal '{}' is not supported on Windows", other.id()),
    };

    let body = match choice {
        TerminalChoice::PowerShell => {
            build_powershell_script(env, &command, &args, window_label, workspace)
        }
        TerminalChoice::Cmd => build_cmd_script(env, &command, &args, window_label, workspace),
        other => bail!("terminal '{}' is not supported on Windows", other.id()),
    };

    std::fs::write(&script_path, body)
        .with_context(|| format!("write launch script {:?}", script_path))?;
    auth::set_owner_only(&script_path).ok();
    Ok(script_path)
}

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_launch_command(command: &str, args: &[String]) -> (String, Vec<String>) {
    let argv = command_words_with_args(command, args);
    let Some((program, program_args)) = argv.split_first() else {
        return (command.to_string(), args.to_vec());
    };

    if !command_stem_eq(program, "codex") {
        return (command.to_string(), args.to_vec());
    }

    let Some(program_path) = find_windows_command(program) else {
        return (command.to_string(), args.to_vec());
    };
    let Some(ext) = program_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        return (command.to_string(), args.to_vec());
    };
    if ext != "cmd" && ext != "ps1" {
        return (command.to_string(), args.to_vec());
    }

    let Some(codex_js) = npm_shim_js_entry(&program_path) else {
        return (command.to_string(), args.to_vec());
    };

    let mut rewritten_args = Vec::with_capacity(program_args.len() + 1);
    rewritten_args.push(codex_js.to_string_lossy().into_owned());
    rewritten_args.extend(program_args.iter().cloned());
    ("node".to_string(), rewritten_args)
}

#[cfg(any(target_os = "windows", test))]
fn command_stem_eq(command: &str, expected: &str) -> bool {
    let file_name = command
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(command)
        .trim_matches('"');
    let stem = file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(file_name);
    stem.eq_ignore_ascii_case(expected)
}

#[cfg(any(target_os = "windows", test))]
fn find_windows_command(program: &str) -> Option<PathBuf> {
    let program = program.trim_matches('"');
    let path = Path::new(program);
    if path.is_absolute() || program.contains('\\') || program.contains('/') {
        return existing_windows_command_path(path);
    }

    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        if let Some(candidate) = existing_windows_command_path(&dir.join(program)) {
            return Some(candidate);
        }
    }
    None
}

#[cfg(any(target_os = "windows", test))]
fn existing_windows_command_path(base: &Path) -> Option<PathBuf> {
    if base.extension().is_some() {
        return base.exists().then(|| base.to_path_buf());
    }

    for ext in windows_path_exts() {
        let candidate = base.with_extension(ext.trim_start_matches('.'));
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(any(target_os = "windows", test))]
fn windows_path_exts() -> Vec<String> {
    let mut exts: Vec<String> = std::env::var("PATHEXT")
        .ok()
        .map(|value| {
            value
                .split(';')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_else(|| {
            vec![
                ".COM".to_string(),
                ".EXE".to_string(),
                ".BAT".to_string(),
                ".CMD".to_string(),
            ]
        });
    if !exts.iter().any(|ext| ext.eq_ignore_ascii_case(".PS1")) {
        exts.push(".PS1".to_string());
    }
    exts
}

#[cfg(any(target_os = "windows", test))]
fn npm_shim_js_entry(shim_path: &Path) -> Option<PathBuf> {
    let body = std::fs::read_to_string(shim_path).ok()?;
    let token = extract_npm_shim_js_token(&body)?;
    let base_dir = shim_path.parent()?;
    let candidate = expand_npm_shim_js_token(base_dir, &token);
    candidate.exists().then_some(candidate)
}

#[cfg(any(target_os = "windows", test))]
fn extract_npm_shim_js_token(body: &str) -> Option<String> {
    for line in body.lines() {
        let mut rest = line;
        while let Some(start) = rest.find('"') {
            rest = &rest[start + 1..];
            let Some(end) = rest.find('"') else {
                break;
            };
            let token = &rest[..end];
            if let Some(js_pos) = token.to_ascii_lowercase().find(".js") {
                return Some(token[..js_pos + 3].to_string());
            }
            rest = &rest[end + 1..];
        }
    }
    None
}

#[cfg(any(target_os = "windows", test))]
fn expand_npm_shim_js_token(base_dir: &Path, token: &str) -> PathBuf {
    let normalized = token.replace('\\', "/");
    for prefix in ["%dp0%/", "%~dp0/", "$basedir/"] {
        if let Some(rest) = normalized.strip_prefix(prefix) {
            return base_dir.join(rest);
        }
    }
    PathBuf::from(token)
}

#[cfg(target_os = "windows")]
fn build_powershell_script(
    env: &[(String, String)],
    command: &str,
    args: &[String],
    window_label: &str,
    workspace: &Path,
) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "Write-Host '# VibeAround profile: {}'\n",
        window_label.replace('\'', "''")
    ));
    for (k, v) in env {
        out.push_str(&format!("$env:{} = '{}'\n", k, v.replace('\'', "''")));
    }
    append_powershell_color_env(&mut out);
    out.push_str(&format!(
        "Set-Location -LiteralPath '{}'\n",
        escape_powershell_single_quoted(&workspace.to_string_lossy())
    ));
    out.push_str(&powershell_command_block(command, args));
    out.push('\n');
    out.push_str("if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) {\n");
    out.push_str("  Write-Host \"`nCommand exited with code $LASTEXITCODE\"\n");
    out.push_str("}\n");
    out.push_str("$scriptPath = $MyInvocation.MyCommand.Path\n");
    out.push_str("if ($scriptPath) { Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue }\n");
    out
}

#[cfg(target_os = "windows")]
fn build_cmd_script(
    env: &[(String, String)],
    command: &str,
    args: &[String],
    window_label: &str,
    workspace: &Path,
) -> String {
    let mut out = String::new();
    out.push_str("@echo off\r\n");
    out.push_str(&format!("@title VibeAround - {}\r\n", window_label));
    out.push_str(&format!("@echo # VibeAround profile: {}\r\n", window_label));
    for (k, v) in env {
        out.push_str(&format!("set \"{}={}\"\r\n", k, v));
    }
    append_cmd_color_env(&mut out);
    out.push_str(&format!(
        "cd /d \"{}\"\r\n",
        escape_cmd_quoted(&workspace.to_string_lossy())
    ));
    out.push_str(&command_with_windows_args(command, args));
    out.push_str("\r\n");
    out.push_str("set \"VA_EXIT=%ERRORLEVEL%\"\r\n");
    out.push_str("if not \"%VA_EXIT%\"==\"0\" echo.\r\n");
    out.push_str("if not \"%VA_EXIT%\"==\"0\" echo Command exited with code %VA_EXIT%\r\n");
    out.push_str("del \"%~f0\" >nul 2>nul\r\n");
    out
}

#[cfg(any(target_os = "windows", test))]
fn powershell_command_block(command: &str, args: &[String]) -> String {
    let argv = command_words_with_args(command, args);
    let Some((program, program_args)) = argv.split_first() else {
        return String::new();
    };

    let mut out = String::new();
    out.push_str(&format!(
        "$vaCommand = {}\n",
        powershell_single_quoted(program)
    ));
    out.push_str("$vaArgs = @(\n");
    for arg in program_args {
        out.push_str("  ");
        out.push_str(&powershell_single_quoted(arg));
        out.push('\n');
    }
    out.push_str(")\n& $vaCommand @vaArgs");
    out
}

#[cfg(any(target_os = "windows", test))]
fn powershell_single_quoted(value: &str) -> String {
    format!("'{}'", escape_powershell_single_quoted(value))
}

#[cfg(any(target_os = "windows", test))]
fn command_with_windows_args(command: &str, args: &[String]) -> String {
    command_words_with_args(command, args)
        .iter()
        .map(|arg| windows_batch_arg(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(any(target_os = "windows", test))]
fn command_words_with_args(command: &str, args: &[String]) -> Vec<String> {
    let mut words = split_command_words(command);
    words.extend(args.iter().cloned());
    words
}

#[cfg(any(target_os = "windows", test))]
fn split_command_words(command: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut chars = command.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match quote {
            Some(q) if ch == q => {
                quote = None;
            }
            Some('"') if ch == '\\' => {
                if matches!(chars.peek(), Some('"') | Some('\\')) {
                    let next = chars.next().expect("peeked next char");
                    current.push(next);
                } else {
                    current.push(ch);
                }
            }
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
            }
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    words.push(std::mem::take(&mut current));
                }
            }
            None => current.push(ch),
        }
    }

    if !current.is_empty() {
        words.push(current);
    }

    words
}

#[cfg(any(target_os = "windows", test))]
fn windows_batch_arg(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');

    let mut pending_backslashes = 0usize;
    for ch in value.chars() {
        match ch {
            '\\' => pending_backslashes += 1,
            '"' => {
                for _ in 0..(pending_backslashes * 2 + 1) {
                    out.push('\\');
                }
                out.push('"');
                pending_backslashes = 0;
            }
            '%' => {
                for _ in 0..pending_backslashes {
                    out.push('\\');
                }
                pending_backslashes = 0;
                out.push_str("%%");
            }
            '\r' | '\n' => {
                for _ in 0..pending_backslashes {
                    out.push('\\');
                }
                pending_backslashes = 0;
                out.push(' ');
            }
            other => {
                for _ in 0..pending_backslashes {
                    out.push('\\');
                }
                pending_backslashes = 0;
                out.push(other);
            }
        }
    }

    for _ in 0..(pending_backslashes * 2) {
        out.push('\\');
    }
    out.push('"');
    out
}

// ---------------------------------------------------------------------------
// Bash script builder
// ---------------------------------------------------------------------------

fn build_bash_script(
    env: &[(String, String)],
    command: &str,
    args: &[String],
    window_label: &str,
    workspace: &Path,
) -> String {
    let mut out = String::new();
    out.push_str("#!/bin/bash\n");
    // Self-delete first so an unexpected ^C between here and `exec` doesn't
    // leave the credential-bearing script sitting in $TMPDIR.
    out.push_str("rm -- \"$0\"\n");
    out.push_str("set -e\n");
    out.push_str(&format!(
        "echo \"# VibeAround profile: {}\"\n",
        // Window label is shown to the user only — sanitize quotes to keep
        // the echo line well-formed; we do not need full shell escape here
        // because the value isn't a security boundary.
        window_label.replace('"', "'")
    ));

    let mut seen: HashMap<&str, ()> = HashMap::new();
    for (k, v) in env {
        if seen.insert(k.as_str(), ()).is_some() {
            // Catalog should not produce duplicate keys, but `last write
            // wins` is more useful than crashing the launch.
            tracing::warn!("[profiles] duplicate env key '{}' in render output", k);
        }
        let escaped = shell_escape::unix::escape(std::borrow::Cow::Borrowed(v.as_str()));
        out.push_str(&format!("export {}={}\n", k, escaped));
    }
    append_bash_color_env(&mut out);

    // `open -a Terminal foo.command` opens the new window with $TMPDIR as
    // CWD; surfacing the user in /private/var/folders/... is jarring. Move
    // to the selected launch workspace before exec so the CLI starts in the
    // project the user intended.
    let workspace_string = workspace.to_string_lossy();
    let cwd = shell_escape::unix::escape(std::borrow::Cow::Borrowed(workspace_string.as_ref()));
    out.push_str(&format!("cd {}\n", cwd));
    out.push_str(&format!("exec {}\n", command_with_unix_args(command, args)));
    out
}

fn append_bash_color_env(out: &mut String) {
    out.push_str("unset NO_COLOR\n");
    out.push_str(
        "if [ -z \"${TERM:-}\" ] || [ \"$TERM\" = \"dumb\" ]; then export TERM=xterm-256color; fi\n",
    );
    out.push_str("export COLORTERM=${COLORTERM:-truecolor}\n");
    out.push_str("export CLICOLOR=${CLICOLOR:-1}\n");
}

#[cfg(any(target_os = "windows", test))]
fn escape_powershell_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn append_powershell_color_env(out: &mut String) {
    out.push_str("Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue\n");
    out.push_str("if (-not $env:TERM -or $env:TERM -eq 'dumb') { $env:TERM = 'xterm-256color' }\n");
    out.push_str("if (-not $env:COLORTERM) { $env:COLORTERM = 'truecolor' }\n");
    out.push_str("if (-not $env:CLICOLOR) { $env:CLICOLOR = '1' }\n");
}

#[cfg(target_os = "windows")]
fn escape_cmd_quoted(value: &str) -> String {
    value.replace('"', "\"\"")
}

#[cfg(target_os = "windows")]
fn append_cmd_color_env(out: &mut String) {
    out.push_str("set \"NO_COLOR=\"\r\n");
    out.push_str("if not defined TERM set \"TERM=xterm-256color\"\r\n");
    out.push_str("if /I \"%TERM%\"==\"dumb\" set \"TERM=xterm-256color\"\r\n");
    out.push_str("if not defined COLORTERM set \"COLORTERM=truecolor\"\r\n");
    out.push_str("if not defined CLICOLOR set \"CLICOLOR=1\"\r\n");
}

#[cfg(target_os = "windows")]
fn quote_cmd_arg(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_bash_script_escapes_injection_payload() {
        let env = vec![(
            "ANTHROPIC_API_KEY".to_string(),
            "hi$(touch /tmp/pwned)".to_string(),
        )];
        let script = build_bash_script(&env, "claude", &[], "Test", Path::new("/tmp/work dir"));
        // The export line must contain the payload as a *literal* — i.e.
        // single-quoted by shell_escape — not as an unquoted command
        // substitution that bash would actually evaluate.
        assert!(
            script.contains("'hi$(touch /tmp/pwned)'"),
            "expected single-quoted payload, got:\n{}",
            script
        );
        assert!(!script.contains("$(touch /tmp/pwned)\n"));
    }

    #[test]
    fn build_bash_script_includes_self_delete_first() {
        let script = build_bash_script(&[], "claude", &[], "x", Path::new("/tmp/work dir"));
        let lines: Vec<&str> = script.lines().collect();
        assert_eq!(lines[0], "#!/bin/bash");
        assert_eq!(lines[1], "rm -- \"$0\"");
    }

    #[test]
    fn build_bash_script_cd_selected_workspace() {
        let script = build_bash_script(&[], "claude", &[], "x", Path::new("/tmp/my project"));
        assert!(script.contains("cd '/tmp/my project'\n"));
    }

    #[test]
    fn build_bash_script_restores_color_capable_terminal_env() {
        let env = vec![("NO_COLOR".to_string(), "1".to_string())];
        let script = build_bash_script(&env, "codex", &[], "x", Path::new("/tmp/work dir"));

        assert!(script.contains("export NO_COLOR=1\n"));
        assert!(script.contains("unset NO_COLOR\n"));
        assert!(script.contains("export TERM=xterm-256color"));
        assert!(script.contains("export COLORTERM=${COLORTERM:-truecolor}\n"));
        assert!(script.contains("export CLICOLOR=${CLICOLOR:-1}\n"));
        assert!(script.find("export NO_COLOR=1").unwrap() < script.find("unset NO_COLOR").unwrap());
    }

    #[test]
    fn build_bash_script_appends_unix_escaped_args() {
        let args = vec![
            "-c".to_string(),
            "hooks.SessionStart=[{ hooks = [{ command = \"hook --agent codex\" }] }]".to_string(),
        ];
        let script = build_bash_script(&[], "codex", &args, "x", Path::new("/tmp/work dir"));

        assert!(script.contains("exec codex -c 'hooks.SessionStart="));
        assert!(script.contains("--agent codex"));
    }

    #[test]
    fn powershell_command_block_keeps_hook_config_as_one_arg() {
        let args = vec![
            "-c".to_string(),
            "hooks.SessionStart=[{ hooks = [{ command = \"\\\"C:\\Program Files\\VibeAround\\vibearound-hook.exe\\\" --agent codex\" }] }]".to_string(),
        ];
        let block = powershell_command_block("claude code --permission-mode acceptEdits", &args);

        assert!(block.contains("$vaCommand = 'claude'"));
        assert!(block.contains("$vaArgs = @("));
        assert!(block.contains("  'code'\n"));
        assert!(block.contains("  '--permission-mode'\n"));
        assert!(block.contains("  'acceptEdits'\n"));
        assert!(block.contains("  '-c'\n"));
        assert!(block
            .lines()
            .any(|line| line.contains("hooks.SessionStart=")));
        assert!(!block.lines().any(|line| line.trim() == "'--agent'"));
        assert!(!block.contains("$vaCommand = 'claude code"));
    }

    #[test]
    fn windows_command_line_does_not_use_unix_quotes() {
        let args = vec![
            "-c".to_string(),
            "hooks.SessionStart=[{ hooks = [{ command = \"hook --agent codex\" }] }]".to_string(),
        ];
        let line = command_with_windows_args("claude code --permission-mode acceptEdits", &args);

        assert!(line.starts_with("\"claude\" \"code\" \"--permission-mode\" \"acceptEdits\" \"-c\" \"hooks.SessionStart="));
        assert!(line.contains("\\\"hook --agent codex\\\""));
        assert!(!line.contains("\"--agent\""));
        assert!(!line.contains("'hooks.SessionStart"));
    }

    #[test]
    fn split_command_words_handles_quoted_segments() {
        assert_eq!(
            split_command_words("\"C:\\Program Files\\tool.exe\" run 'two words'"),
            vec!["C:\\Program Files\\tool.exe", "run", "two words"]
        );
    }

    #[test]
    fn extracts_codex_js_from_npm_cmd_shim() {
        let shim = r#"@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
) ELSE (
  node  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
)"#;

        assert_eq!(
            extract_npm_shim_js_token(shim).as_deref(),
            Some("%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js")
        );
    }

    #[test]
    fn extracts_codex_js_from_npm_powershell_shim() {
        let shim = r#"if (Test-Path "$basedir/node.exe") {
  & "$basedir/node.exe" "$basedir/node_modules/@openai/codex/bin/codex.js" $args
} else {
  & "node.exe" "$basedir/node_modules/@openai/codex/bin/codex.js" $args
}"#;

        assert_eq!(
            extract_npm_shim_js_token(shim).as_deref(),
            Some("$basedir/node_modules/@openai/codex/bin/codex.js")
        );
    }

    #[test]
    fn windows_launch_rewrites_codex_shim_to_node_entrypoint() {
        let root = std::env::temp_dir().join(format!(
            "vibearound-codex-shim-test-{}",
            uuid::Uuid::new_v4()
        ));
        let js_path = root
            .join("node_modules")
            .join("@openai")
            .join("codex")
            .join("bin")
            .join("codex.js");
        std::fs::create_dir_all(js_path.parent().unwrap()).unwrap();
        std::fs::write(&js_path, "").unwrap();
        let shim_path = root.join("codex.ps1");
        std::fs::write(
            &shim_path,
            r#"& "node.exe" "$basedir/node_modules/@openai/codex/bin/codex.js" $args"#,
        )
        .unwrap();

        let args = vec![
            "-c".to_string(),
            "hooks.SessionStart=[{ hooks = [{ command = \"hook --agent codex\" }] }]".to_string(),
        ];
        let (command, rewritten_args) =
            normalize_windows_launch_command(&shim_path.to_string_lossy(), &args);

        assert_eq!(command, "node");
        assert_eq!(
            rewritten_args.first().map(String::as_str),
            Some(js_path.to_str().unwrap())
        );
        assert_eq!(&rewritten_args[1..], &args[..]);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn appends_codex_config_args_for_proxy() {
        let mut args = Vec::new();
        push_codex_config_arg(
            &mut args,
            "model_providers.deepseek.base_url",
            &toml_basic_string("http://127.0.0.1:12358/va/openai-proxy/deepseek/launch-123/v1"),
        );
        push_codex_config_arg(
            &mut args,
            "model_providers.deepseek.wire_api",
            &toml_basic_string("responses"),
        );

        assert_eq!(
            args,
            vec![
                "-c".to_string(),
                "model_providers.deepseek.base_url=\"http://127.0.0.1:12358/va/openai-proxy/deepseek/launch-123/v1\"".to_string(),
                "-c".to_string(),
                "model_providers.deepseek.wire_api=\"responses\"".to_string(),
            ]
        );
    }

    #[test]
    fn builds_codex_hook_config_arg_value() {
        let command = build_hook_command(
            Path::new("/Applications/VibeAround.app/Contents/MacOS/vibearound-hook"),
            "SessionStart",
            "launch-123",
            "profile-456",
            "codex",
            "http://127.0.0.1:12358",
        );
        let value = codex_hook_config_value(Some("startup|resume|clear"), &command);

        assert!(value.starts_with("[{ matcher = \"startup|resume|clear\""));
        assert!(value.contains("hooks = [{ type = \"command\""));
        assert!(value.contains("--launch-id launch-123"));
        assert!(value.contains("--profile-id profile-456"));
        assert!(value.ends_with(" }]"));
    }
}
