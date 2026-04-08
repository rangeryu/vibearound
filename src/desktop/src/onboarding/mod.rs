//! Onboarding: first-run setup wizard.
//! Checks whether settings.json has `"onboarded": true`; exposes Tauri IPC
//! commands so the desktop-ui frontend can read/write settings and signal completion.

mod agent_integrations;
mod plugin_install;
mod plugin_session;

pub use plugin_install::{
    check_plugin_status, install_plugin,
    // Re-export Tauri macro-generated handler identifiers so generate_handler! works
    // when commands are referenced as `onboarding::install_plugin`.
    __cmd__install_plugin, __cmd__check_plugin_status,
};
pub use plugin_session::PluginSession;

use std::collections::HashMap;
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::sync::{Mutex, Notify};

use crate::{restart_daemon, OnboardingActive};
use common::config;
use common::plugins;

// ---------------------------------------------------------------------------
// Shared state types
// ---------------------------------------------------------------------------

pub struct OnboardingGate {
    pub notify: Arc<Notify>,
}

pub struct OnboardingSessions {
    pub plugin_sessions: Arc<Mutex<HashMap<String, PluginSession>>>,
}

/// State for the granular onboarding install flow.
pub struct OnboardingInstallState {
    pub cancelled: Arc<AtomicBool>,
    pub child_process: Arc<Mutex<Option<tokio::process::Child>>>,
    pub log_file: Arc<Mutex<Option<std::fs::File>>>,
}

impl Default for OnboardingInstallState {
    fn default() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            child_process: Arc::new(Mutex::new(None)),
            log_file: Arc::new(Mutex::new(None)),
        }
    }
}

/// Progress event emitted to the frontend during onboarding install.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgressEvent {
    pub id: String,
    pub label: String,
    pub status: String,
    pub message: Option<String>,
}

/// Task info returned by `get_install_manifest`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallTaskInfo {
    pub id: String,
    pub label: String,
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

fn settings_path() -> PathBuf {
    config::data_dir().join("settings.json")
}

fn read_settings_value() -> Value {
    let path = settings_path();
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn write_settings_value(val: &Value) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let pretty = serde_json::to_string_pretty(val).map_err(|e| e.to_string())?;
    std::fs::write(&path, pretty).map_err(|e| e.to_string())?;
    // settings.json holds bot tokens, webhook secrets, and tunnel credentials
    // in plain text (by design — the user edits this file directly). Ensure
    // other local users cannot read it. No-op on Windows.
    common::auth::set_owner_only(&path).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Onboarding gate
// ---------------------------------------------------------------------------

/// Read current settings (exposed for startup integration sync).
pub fn get_settings_value() -> serde_json::Value {
    read_settings_value()
}

pub fn needs_onboarding() -> bool {
    let val = read_settings_value();
    !val.get("onboarded")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Resource summary types — expose agent/tunnel/plugin definitions to frontend
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct AgentSummary {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub install_type: Option<String>,
}

#[derive(serde::Serialize)]
pub struct TunnelSummary {
    pub id: String,
    pub display_name: String,
}

#[derive(serde::Serialize)]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub github: String,
}

// ---------------------------------------------------------------------------
// Tauri commands — settings
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings() -> Result<Value, String> {
    Ok(read_settings_value())
}

#[tauri::command]
pub fn list_channel_plugins() -> Result<Vec<plugins::DiscoveredPluginSummary>, String> {
    Ok(plugins::list_channel_plugin_summaries())
}

#[tauri::command]
pub fn save_settings(settings: Value) -> Result<(), String> {
    write_settings_value(&settings)
}

// ---------------------------------------------------------------------------
// Tauri commands — resource queries
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_agents() -> Vec<AgentSummary> {
    common::resources::AGENTS
        .iter()
        .map(|a| AgentSummary {
            id: a.id.clone(),
            display_name: a.display_name.clone(),
            description: a.description.clone(),
            install_type: a.install.as_ref().map(|i| i.install_type.clone()),
        })
        .collect()
}

#[tauri::command]
pub fn list_tunnels() -> Vec<TunnelSummary> {
    common::resources::TUNNELS
        .iter()
        .map(|t| TunnelSummary {
            id: t.id.clone(),
            display_name: t.display_name.clone(),
        })
        .collect()
}

#[tauri::command]
pub fn list_plugin_registry() -> Vec<PluginSummary> {
    common::resources::PLUGINS
        .iter()
        .map(|p| PluginSummary {
            id: p.id.clone(),
            name: p.name.clone(),
            description: p.description.clone(),
            github: p.github.clone(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Tauri commands — onboarding flow
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAuthStartRequest {
    pub plugin_id: String,
    pub config: Value,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAuthWaitRequest {
    pub plugin_id: String,
    pub params: Value,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAuthCancelRequest {
    pub plugin_id: String,
}

#[tauri::command]
pub async fn plugin_auth_start(
    state: State<'_, OnboardingSessions>,
    request: PluginAuthStartRequest,
) -> Result<Value, String> {
    let mut sessions = state.plugin_sessions.lock().await;
    if let Some(mut existing) = sessions.remove(&request.plugin_id) {
        plugin_session::shutdown_plugin_session(&mut existing).await;
    }

    let mut session =
        plugin_session::spawn_auth_session(&request.plugin_id, request.config.clone())
            .await
            .map_err(|e| e.to_string())?;

    let result: Value =
        plugin_session::plugin_request(&mut session, "login_qr_start", request.config)
            .await
            .map_err(|e| e.to_string())?;

    sessions.insert(request.plugin_id, session);
    Ok(result)
}

#[tauri::command]
pub async fn plugin_auth_wait(
    state: State<'_, OnboardingSessions>,
    request: PluginAuthWaitRequest,
) -> Result<Value, String> {
    let mut sessions = state.plugin_sessions.lock().await;
    let session = sessions
        .get_mut(&request.plugin_id)
        .ok_or_else(|| format!("auth session for '{}' not started", request.plugin_id))?;

    let result: Value =
        plugin_session::plugin_request(session, "login_qr_wait", request.params)
            .await
            .map_err(|e| e.to_string())?;

    // Shutdown on success
    if result.get("connected").and_then(|v| v.as_bool()).unwrap_or(false) {
        if let Some(mut session) = sessions.remove(&request.plugin_id) {
            plugin_session::shutdown_plugin_session(&mut session).await;
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn plugin_auth_cancel(
    state: State<'_, OnboardingSessions>,
    request: PluginAuthCancelRequest,
) -> Result<(), String> {
    let mut sessions = state.plugin_sessions.lock().await;
    if let Some(mut session) = sessions.remove(&request.plugin_id) {
        plugin_session::shutdown_plugin_session(&mut session).await;
    }
    Ok(())
}

/// Called after `start_onboarding_install` completes. Signals the daemon gate
/// and navigates the user to the dashboard.
#[tauri::command]
pub async fn finish_onboarding<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OnboardingSessions>,
) -> Result<(), String> {
    // Clean up any remaining auth sessions
    let mut sessions = state.plugin_sessions.lock().await;
    for (_, mut session) in sessions.drain() {
        plugin_session::shutdown_plugin_session(&mut session).await;
    }
    drop(sessions);

    let _ = app.emit("onboarding-complete", ());

    if let Some(active) = app.try_state::<OnboardingActive>() {
        let was_onboarding = active
            .0
            .swap(false, Ordering::Relaxed);
        if was_onboarding {
            if let Some(gate) = app.try_state::<OnboardingGate>() {
                gate.notify.notify_one();
            }
        } else {
            restart_daemon(&app).await?;
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands — install manifest + orchestrated install
// ---------------------------------------------------------------------------

/// Returns the list of install tasks for the given settings, so the frontend
/// can pre-populate the progress list before install starts.
#[tauri::command]
pub fn get_install_manifest(settings: Value) -> Vec<InstallTaskInfo> {
    let all_agents = common::resources::agent_ids();
    let enabled_agents = resolve_enabled_agents(&settings, &all_agents);

    let mut tasks = Vec::new();

    for agent_id in &enabled_agents {
        let agent_def = match common::resources::agent_by_id(agent_id) {
            Some(def) => def,
            None => continue,
        };

        // MCP config + skill are always installed
        if agent_def.global_config.is_some() {
            tasks.push(InstallTaskInfo {
                id: format!("agent:{}:mcp", agent_id),
                label: format!("{} — MCP config", agent_def.display_name),
            });
            if agent_def.global_config.as_ref().and_then(|c| c.skill_dir.as_ref()).is_some() {
                tasks.push(InstallTaskInfo {
                    id: format!("agent:{}:skill", agent_id),
                    label: format!("{} — Skill file", agent_def.display_name),
                    });
            }
        }

        // ACP agent install (npm or script) — only for installable types
        let install_type = agent_def.install.as_ref().map(|i| i.install_type.as_str());
        if matches!(install_type, Some("npm") | Some("script")) {
            tasks.push(InstallTaskInfo {
                id: format!("agent:{}:acp", agent_id),
                label: format!("{} — CLI install", agent_def.display_name),
            });
        }
    }

    // Channel plugins
    let enabled_channels = settings
        .get("channels")
        .and_then(|v| v.as_object())
        .map(|obj| obj.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    for channel_id in &enabled_channels {
        let plugin_def = common::resources::plugin_by_id(channel_id);
        let label = plugin_def
            .map(|p| p.name.clone())
            .unwrap_or_else(|| channel_id.clone());
        tasks.push(InstallTaskInfo {
            id: format!("plugin:{}", channel_id),
            label: format!("{} — Plugin install", label),
        });
    }

    tasks
}

/// Orchestrates the full onboarding install sequence. Saves settings, then
/// installs MCP configs, skills, ACP agents, and channel plugins one by one,
/// emitting `"onboarding-install-progress"` events for each task.
///
/// This command is fire-and-forget from the frontend's perspective: it spawns
/// the install work on a background task and returns immediately.
#[tauri::command]
pub async fn start_onboarding_install<R: Runtime>(
    app: AppHandle<R>,
    install_state: State<'_, OnboardingInstallState>,
    settings: Value,
) -> Result<(), String> {
    // Reset cancellation flag
    install_state.cancelled.store(false, Ordering::Relaxed);

    // Save settings with onboarded: true
    let mut val = settings.clone();
    if let Some(obj) = val.as_object_mut() {
        obj.insert("onboarded".into(), serde_json::json!(true));
    }
    write_settings_value(&val)?;

    // Create log file
    let log_dir = config::data_dir().join("logs").join("onboarding");
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let timestamp = {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        format!("{}", now)
    };
    let log_path = log_dir.join(format!("{}.log", timestamp));
    let log_file = std::fs::File::create(&log_path).map_err(|e| e.to_string())?;
    {
        let mut lf = install_state.log_file.lock().await;
        *lf = Some(log_file);
    }

    let cancelled = Arc::clone(&install_state.cancelled);
    let child_proc = Arc::clone(&install_state.child_process);
    let log_file_arc = Arc::clone(&install_state.log_file);

    // Spawn the install work on a background task
    tauri::async_runtime::spawn(async move {
        run_onboarding_install(app, val, cancelled, child_proc, log_file_arc).await;
    });

    Ok(())
}

/// Cancel a running onboarding install.
#[tauri::command]
pub async fn cancel_onboarding_install(
    install_state: State<'_, OnboardingInstallState>,
) -> Result<(), String> {
    install_state.cancelled.store(true, Ordering::Relaxed);

    // Kill any running child process
    let mut child = install_state.child_process.lock().await;
    if let Some(ref mut proc) = *child {
        let _ = proc.kill().await;
    }
    *child = None;

    Ok(())
}

// ---------------------------------------------------------------------------
// Install orchestration (runs on background task)
// ---------------------------------------------------------------------------

fn emit_progress<R: Runtime>(app: &AppHandle<R>, event: &InstallProgressEvent) {
    let _ = app.emit("onboarding-install-progress", event);
}

fn log_line(log_file: &Arc<Mutex<Option<std::fs::File>>>, line: &str) {
    if let Ok(mut guard) = log_file.try_lock() {
        if let Some(ref mut f) = *guard {
            let _ = writeln!(f, "{}", line);
        }
    }
}

async fn run_onboarding_install<R: Runtime>(
    app: AppHandle<R>,
    settings: Value,
    cancelled: Arc<AtomicBool>,
    _child_proc: Arc<Mutex<Option<tokio::process::Child>>>,
    log_file: Arc<Mutex<Option<std::fs::File>>>,
) {
    let all_agents = common::resources::agent_ids();
    let enabled_agents = resolve_enabled_agents(&settings, &all_agents);
    let mut had_error = false;

    // --- Agent installs ---
    for agent_id in &enabled_agents {
        if cancelled.load(Ordering::Relaxed) {
            break;
        }

        let agent_def = match common::resources::agent_by_id(agent_id) {
            Some(def) => def,
            None => continue,
        };

        // MCP config
        if agent_def.global_config.is_some() {
            let task_id = format!("agent:{}:mcp", agent_id);
            emit_progress(&app, &InstallProgressEvent {
                id: task_id.clone(),
                label: format!("{} — MCP config", agent_def.display_name),
                status: "running".into(),
                message: Some("Installing MCP config…".into()),
            });
            log_line(&log_file, &format!("[{}] Installing MCP config", agent_id));

            // Reuse sync logic — installs MCP config + skills for all enabled agents
            common::agent_integrations::sync_integrations(&settings);

            emit_progress(&app, &InstallProgressEvent {
                id: task_id,
                label: format!("{} — MCP config", agent_def.display_name),
                status: "done".into(),
                message: None,
            });

            // Skill file
            if agent_def.global_config.as_ref().and_then(|c| c.skill_dir.as_ref()).is_some() {
                let skill_id = format!("agent:{}:skill", agent_id);
                emit_progress(&app, &InstallProgressEvent {
                    id: skill_id.clone(),
                    label: format!("{} — Skill file", agent_def.display_name),
                    status: "done".into(),
                    message: None,
                });
            }
        }

        if cancelled.load(Ordering::Relaxed) {
            break;
        }

        // ACP agent install (npm or script)
        let install_type = agent_def.install.as_ref().map(|i| i.install_type.as_str());
        match install_type {
            Some("npm") => {
                let task_id = format!("agent:{}:acp", agent_id);
                if let Some(npm_pkg) = &agent_def.acp.npm_package {
                    let bin_name = agent_def.acp.bin_name.as_deref().unwrap_or(npm_pkg);
                    if common::env::resolve_acp_agent_bin(bin_name).is_ok() {
                        emit_progress(&app, &InstallProgressEvent {
                            id: task_id,
                            label: format!("{} — CLI install", agent_def.display_name),
                            status: "skipped".into(),
                            message: Some("Already installed".into()),
                        });
                        log_line(&log_file, &format!("[{}] ACP agent already installed, skipping", agent_id));
                    } else {
                        let msg = format!("Running: npm install {}", npm_pkg);
                        emit_progress(&app, &InstallProgressEvent {
                            id: task_id.clone(),
                            label: format!("{} — CLI install", agent_def.display_name),
                            status: "running".into(),
                            message: Some(msg.clone()),
                        });
                        log_line(&log_file, &format!("[{}] {}", agent_id, msg));

                        match common::agent_integrations::auto_install_npm_agent_with_output(npm_pkg).await {
                            Ok(out) => {
                                log_line(&log_file, &format!("[{}] stdout:\n{}", agent_id, out.stdout));
                                log_line(&log_file, &format!("[{}] stderr:\n{}", agent_id, out.stderr));
                                emit_progress(&app, &InstallProgressEvent {
                                    id: task_id,
                                    label: format!("{} — CLI install", agent_def.display_name),
                                    status: "done".into(),
                                    message: None,
                                });
                                log_line(&log_file, &format!("[{}] npm install complete", agent_id));
                            }
                            Err(e) => {
                                had_error = true;
                                let err_msg = format!("{:#}", e);
                                emit_progress(&app, &InstallProgressEvent {
                                    id: task_id,
                                    label: format!("{} — CLI install", agent_def.display_name),
                                    status: "error".into(),
                                    message: Some(err_msg.clone()),
                                });
                                log_line(&log_file, &format!("[{}] ERROR: {}", agent_id, err_msg));
                            }
                        }
                    }
                }
            }
            Some("script") => {
                let task_id = format!("agent:{}:acp", agent_id);
                if common::agent_integrations::is_program_available(&agent_def.acp.program) {
                    emit_progress(&app, &InstallProgressEvent {
                        id: task_id,
                        label: format!("{} — CLI install", agent_def.display_name),
                        status: "skipped".into(),
                        message: Some("Already installed".into()),
                    });
                    log_line(&log_file, &format!("[{}] CLI already available in PATH, skipping", agent_id));
                } else if let Some(install_cmd) = &agent_def.acp.install_cmd {
                    let msg = format!("Running: {}", install_cmd);
                    emit_progress(&app, &InstallProgressEvent {
                        id: task_id.clone(),
                        label: format!("{} — CLI install", agent_def.display_name),
                        status: "running".into(),
                        message: Some(msg.clone()),
                    });
                    log_line(&log_file, &format!("[{}] {}", agent_id, msg));

                    match common::agent_integrations::auto_install_agent_cmd_with_output(install_cmd, agent_id).await {
                        Ok(out) => {
                            log_line(&log_file, &format!("[{}] stdout:\n{}", agent_id, out.stdout));
                            log_line(&log_file, &format!("[{}] stderr:\n{}", agent_id, out.stderr));
                            emit_progress(&app, &InstallProgressEvent {
                                id: task_id,
                                label: format!("{} — CLI install", agent_def.display_name),
                                status: "done".into(),
                                message: None,
                            });
                            log_line(&log_file, &format!("[{}] script install complete", agent_id));
                        }
                        Err(e) => {
                            had_error = true;
                            let err_msg = format!("{:#}", e);
                            emit_progress(&app, &InstallProgressEvent {
                                id: task_id,
                                label: format!("{} — CLI install", agent_def.display_name),
                                status: "error".into(),
                                message: Some(err_msg.clone()),
                            });
                            log_line(&log_file, &format!("[{}] ERROR: {}", agent_id, err_msg));
                        }
                    }
                }
            }
            _ => {} // "path" type — nothing to install
        }
    }

    // --- Channel plugin installs ---
    let enabled_channels = settings
        .get("channels")
        .and_then(|v| v.as_object())
        .map(|obj| obj.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    for channel_id in &enabled_channels {
        if cancelled.load(Ordering::Relaxed) {
            break;
        }

        let task_id = format!("plugin:{}", channel_id);
        let plugin_def = common::resources::plugin_by_id(channel_id);
        let label = plugin_def
            .map(|p| p.name.clone())
            .unwrap_or_else(|| channel_id.clone());

        // Check if already ready
        let status = plugin_install::check_plugin_status(channel_id.clone());
        if status == "ready" {
            emit_progress(&app, &InstallProgressEvent {
                id: task_id,
                label: format!("{} — Plugin install", label),
                status: "skipped".into(),
                message: Some("Already installed".into()),
            });
            log_line(&log_file, &format!("[plugin:{}] Already ready, skipping", channel_id));
            continue;
        }

        let github_url = match plugin_def {
            Some(p) => p.github.clone(),
            None => {
                emit_progress(&app, &InstallProgressEvent {
                    id: task_id,
                    label: format!("{} — Plugin install", label),
                    status: "error".into(),
                    message: Some("Plugin not found in registry".into()),
                });
                had_error = true;
                continue;
            }
        };

        emit_progress(&app, &InstallProgressEvent {
            id: task_id.clone(),
            label: format!("{} — Plugin install", label),
            status: "running".into(),
            message: Some(format!("Running: git clone + npm install + build")),
        });
        log_line(&log_file, &format!("[plugin:{}] Starting install from {}", channel_id, github_url));

        let request = plugin_install::InstallPluginRequest {
            plugin_id: channel_id.clone(),
            github_url,
        };
        match plugin_install::run_install_inner(request).await {
            Ok(resp) => {
                if resp.success {
                    emit_progress(&app, &InstallProgressEvent {
                        id: task_id,
                        label: format!("{} — Plugin install", label),
                        status: "done".into(),
                        message: None,
                    });
                    log_line(&log_file, &format!("[plugin:{}] Install complete", channel_id));
                } else {
                    had_error = true;
                    emit_progress(&app, &InstallProgressEvent {
                        id: task_id,
                        label: format!("{} — Plugin install", label),
                        status: "error".into(),
                        message: Some(resp.message),
                    });
                }
            }
            Err(e) => {
                had_error = true;
                let err_msg = format!("{:#}", e);
                emit_progress(&app, &InstallProgressEvent {
                    id: task_id,
                    label: format!("{} — Plugin install", label),
                    status: "error".into(),
                    message: Some(err_msg.clone()),
                });
                log_line(&log_file, &format!("[plugin:{}] ERROR: {}", channel_id, err_msg));
            }
        }
    }

    // Emit final complete event
    let final_status = if cancelled.load(Ordering::Relaxed) {
        "cancelled"
    } else if had_error {
        "error"
    } else {
        "complete"
    };

    let _ = app.emit("onboarding-install-complete", serde_json::json!({
        "status": final_status,
    }));

    // Close log file
    let mut lf = log_file.lock().await;
    *lf = None;
}

/// Resolve which agents are enabled from settings.
fn resolve_enabled_agents(settings: &Value, all_agents: &[&str]) -> Vec<String> {
    settings
        .get("enabled_agents")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|| all_agents.iter().map(|s| s.to_string()).collect())
}
