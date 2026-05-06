//! Terminal launcher planning.
//!
//! This module owns profile/direct launch planning. Concern-specific modules
//! render profile/proxy/Codex details; platform modules execute the final plan
//! in the user's selected terminal.

mod codex;
mod common;
mod proxy;

#[cfg(target_os = "macos")]
#[path = "launcher/macos.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "launcher/windows.rs"]
mod platform;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[path = "launcher/linux.rs"]
mod platform;

#[cfg(all(test, target_os = "macos"))]
#[allow(dead_code)]
#[path = "launcher/linux.rs"]
mod linux_for_tests;

use self::common::LaunchPlan;
use ::common::{profiles, resources};
use anyhow::anyhow;

use super::terminal;
use profiles::ProfileDef;

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

pub fn launch(profile: &ProfileDef, launch_target: &str) -> anyhow::Result<()> {
    let launch_id = uuid::Uuid::new_v4().to_string();
    let mut rendered = proxy::render_for_launch(profile, launch_target, &launch_id)?;
    codex::apply_session_hooks(profile, launch_target, &launch_id, &mut rendered)?;
    launch_rendered_profile(profile, launch_target, &launch_id, rendered)
}

pub fn launch_resume(
    profile: &ProfileDef,
    launch_target: &str,
    session_id: &str,
) -> anyhow::Result<()> {
    let launch_id = uuid::Uuid::new_v4().to_string();
    let mut rendered = proxy::render_for_launch(profile, launch_target, &launch_id)?;
    codex::apply_session_hooks(profile, launch_target, &launch_id, &mut rendered)?;
    launch_rendered_profile_resume(profile, launch_target, &launch_id, rendered, session_id)
}

/// "Direct" launch opens the named coding CLI with no env injection. The CLI
/// uses whatever global OAuth/login/config it already has on disk.
pub fn launch_direct(agent_id: &str) -> anyhow::Result<()> {
    let agent = resources::agent_by_id(agent_id)
        .ok_or_else(|| anyhow!("agent '{}' not found in agents.json", agent_id))?;
    let workspace = terminal::resolve_workspace_preference()?;
    platform::spawn(LaunchPlan {
        env: Vec::new(),
        command: agent.pty.command.clone(),
        args: Vec::new(),
        window_label: format!("{} (direct)", agent.display_name),
        workspace,
    })
}

pub fn launch_direct_resume(agent_id: &str, session_id: &str) -> anyhow::Result<()> {
    let agent = resources::agent_by_id(agent_id)
        .ok_or_else(|| anyhow!("agent '{}' not found in agents.json", agent_id))?;
    let workspace = terminal::resolve_workspace_preference()?;
    let (command, args) = resume_command_for_agent(agent_id, session_id)?;
    platform::spawn(LaunchPlan {
        env: Vec::new(),
        command,
        args,
        window_label: format!("{} (resume)", agent.display_name),
        workspace,
    })
}

fn launch_rendered_profile(
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

    platform::spawn(LaunchPlan {
        env,
        command: agent.pty.command.clone(),
        args: command_args,
        window_label: profile.label.clone(),
        workspace,
    })
}

fn launch_rendered_profile_resume(
    profile: &ProfileDef,
    launch_target: &str,
    launch_id: &str,
    rendered: profiles::render::RenderedProfile,
    session_id: &str,
) -> anyhow::Result<()> {
    let mut env = profiles::runtime::materialize_env(&profile.id, rendered.clone())?;
    env.push(("VIBEAROUND_LAUNCH_ID".to_string(), launch_id.to_string()));
    env.push(("VIBEAROUND_PROFILE_ID".to_string(), profile.id.clone()));
    env.push((
        "VIBEAROUND_LAUNCH_TARGET".to_string(),
        launch_target.to_string(),
    ));

    let agent_id = profiles::runtime::agent_id_for(launch_target)?;
    let workspace = terminal::resolve_workspace_preference()?;
    let (command, mut args) = resume_command_for_agent(agent_id, session_id)?;
    if agent_id == "codex" {
        let mut codex_args = rendered.command_args.clone();
        codex_args.extend(args);
        args = codex_args;
    }

    platform::spawn(LaunchPlan {
        env,
        command,
        args,
        window_label: format!("{} (resume)", profile.label),
        workspace,
    })
}

fn resume_command_for_agent(
    agent_id: &str,
    session_id: &str,
) -> anyhow::Result<(String, Vec<String>)> {
    let command = match agent_id {
        "claude" => (
            "claude".to_string(),
            vec![
                "--resume".to_string(),
                session_id.to_string(),
                "--permission-mode".to_string(),
                "acceptEdits".to_string(),
            ],
        ),
        "codex" => (
            "codex".to_string(),
            vec!["resume".to_string(), session_id.to_string()],
        ),
        "gemini" => (
            "gemini".to_string(),
            vec!["--resume".to_string(), session_id.to_string()],
        ),
        "opencode" => (
            "opencode".to_string(),
            vec!["--session".to_string(), session_id.to_string()],
        ),
        "cursor" => (
            "cursor-agent".to_string(),
            vec!["--resume".to_string(), session_id.to_string()],
        ),
        "qwen-code" => (
            "qwen".to_string(),
            vec!["--resume".to_string(), session_id.to_string()],
        ),
        other => {
            return Err(anyhow!(
                "resume launch is not supported for agent '{}'",
                other
            ))
        }
    };
    Ok(command)
}
