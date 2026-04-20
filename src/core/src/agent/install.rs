//! Auto-install agent binaries: npm ACP agents + native CLIs with install commands.
//!
//! Called from two paths:
//! - Onboarding / pre-install: `install_acp_agents` iterates enabled agents.
//! - Lazy install: `Agent::spawn` falls through here when a binary is missing.

use anyhow::Context;

use crate::resources;

/// Output captured from an install command.
pub struct InstallOutput {
    pub stdout: String,
    pub stderr: String,
}

/// Auto-install an npm ACP agent package into `~/.vibearound/plugins/`.
pub async fn auto_install_npm_agent(npm_package: &str) -> anyhow::Result<()> {
    auto_install_npm_agent_with_output(npm_package)
        .await
        .map(|_| ())
}

/// Like `auto_install_npm_agent` but returns captured stdout/stderr.
pub async fn auto_install_npm_agent_with_output(
    npm_package: &str,
) -> anyhow::Result<InstallOutput> {
    let plugins_dir = crate::process::env::acp_agents_dir();
    std::fs::create_dir_all(&plugins_dir).with_context(|| format!("creating {:?}", plugins_dir))?;

    let pkg_json = plugins_dir.join("package.json");
    if !pkg_json.exists() {
        let init = serde_json::json!({ "name": "vibearound-plugins", "private": true });
        std::fs::write(&pkg_json, serde_json::to_string_pretty(&init).unwrap())
            .context("writing package.json")?;
    }

    let output = crate::process::env::command("npm")
        .args(["install", npm_package])
        .current_dir(&plugins_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .with_context(|| format!("running npm install {}", npm_package))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        anyhow::bail!("npm install {} failed: {}", npm_package, stderr.trim());
    }
    tracing::info!("[agent] installed {}", npm_package);
    Ok(InstallOutput { stdout, stderr })
}

/// Install a native agent CLI by running its official install command.
pub async fn auto_install_agent_cmd(install_cmd: &str, agent: &str) -> anyhow::Result<()> {
    auto_install_agent_cmd_with_output(install_cmd, agent)
        .await
        .map(|_| ())
}

/// Like `auto_install_agent_cmd` but returns captured stdout/stderr.
pub async fn auto_install_agent_cmd_with_output(
    install_cmd: &str,
    agent: &str,
) -> anyhow::Result<InstallOutput> {
    tracing::info!("[agent] running install for {}: {}", agent, install_cmd);

    let output = crate::process::env::command("sh")
        .args(["-c", install_cmd])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .with_context(|| format!("running install cmd for {}", agent))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        anyhow::bail!("install {} failed: {}", agent, stderr.trim());
    }

    tracing::info!("[agent] installed {}", agent);
    Ok(InstallOutput { stdout, stderr })
}

/// Check if a program is available in PATH.
pub fn is_program_available(program: &str) -> bool {
    crate::process::env::std_command("which")
        .arg(program)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Pre-install all ACP agent packages (npm or binary) for enabled agents.
pub async fn install_acp_agents(settings: &serde_json::Value) {
    let all_agents = resources::agent_ids();
    let enabled_agents = super::resolve_enabled_agents(settings, &all_agents);

    for agent_id in &enabled_agents {
        let agent_def = match resources::agent_by_id(agent_id) {
            Some(def) => def,
            None => continue,
        };

        // npm-based agents (Claude ACP, Codex ACP)
        if let Some(npm_pkg) = &agent_def.acp.npm_package {
            let bin_name = agent_def.acp.bin_name.as_deref().unwrap_or(npm_pkg);
            if crate::process::env::resolve_acp_agent_bin(bin_name).is_ok() {
                continue;
            }
            tracing::info!("[agent] installing ACP agent: {}", npm_pkg);
            if let Err(e) = auto_install_npm_agent(npm_pkg).await {
                tracing::info!("[agent] npm install {} error: {}", npm_pkg, e);
            }
        }
        // Native binary agents with install command (Cursor, Kiro)
        else if let Some(install_cmd) = &agent_def.acp.install_cmd {
            if is_program_available(&agent_def.acp.program) {
                continue;
            }
            if let Err(e) = auto_install_agent_cmd(install_cmd, agent_id).await {
                tracing::info!("[agent] install {} error: {}", agent_id, e);
            }
        }
    }
}
