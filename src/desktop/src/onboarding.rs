//! Onboarding: first-run setup wizard.
//! Checks whether settings.json has `"onboarded": true`; exposes Tauri IPC
//! commands so the desktop-ui frontend can read/write settings and signal completion.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{Mutex, Notify};

use crate::{restart_daemon, OnboardingActive};
use common::config;
use common::plugins;

pub struct OnboardingGate {
    pub notify: Arc<Notify>,
}

pub struct OnboardingSessions {
    pub plugin_sessions: Arc<Mutex<HashMap<String, PluginSession>>>,
}

pub struct PluginSession {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_request_id: u64,
}

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
    std::fs::write(&path, pretty).map_err(|e| e.to_string())
}

async fn spawn_plugin_session(name: &str, config_value: Value) -> Result<PluginSession, String> {
    let plugin = plugins::find_plugin(name)
        .ok_or_else(|| format!("plugin '{}' not found or not built", name))?;
    let entry_point = plugin.entry_path();
    let plugin_dir = plugin.dir;

    let mut child = Command::new("node")
        .arg(entry_point)
        .current_dir(&plugin_dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to spawn plugin '{}': {}", name, e))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "plugin stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "plugin stdout unavailable".to_string())?;
    let stderr = child.stderr.take();
    if let Some(stderr) = stderr {
        let name = name.to_string();
        tauri::async_runtime::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[onboarding:{}] {}", name, line);
            }
        });
    }

    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "config": config_value,
            "hostVersion": env!("CARGO_PKG_VERSION"),
        }
    });
    let line = serde_json::to_string(&init_req).map_err(|e| e.to_string())? + "\n";
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("failed to initialize plugin '{}': {}", name, e))?;
    stdin.flush().await.map_err(|e| e.to_string())?;

    let mut stdout = BufReader::new(stdout);
    loop {
        let mut line = String::new();
        let bytes = stdout.read_line(&mut line).await.map_err(|e| e.to_string())?;
        if bytes == 0 {
            return Err(format!("plugin '{}' exited before initialize completed", name));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let msg: Value = serde_json::from_str(trimmed).map_err(|e| e.to_string())?;
        let id = msg.get("id").and_then(|v| v.as_u64());
        if id != Some(1) {
            continue;
        }
        if let Some(error) = msg.get("error") {
            let message = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown plugin error");
            return Err(message.to_string());
        }
        break;
    }

    Ok(PluginSession {
        child,
        stdin,
        stdout,
        next_request_id: 2,
    })
}

async fn plugin_request<T: for<'de> Deserialize<'de>>(
    session: &mut PluginSession,
    method: &str,
    params: Value,
) -> Result<T, String> {
    let request_id = session.next_request_id;
    session.next_request_id += 1;

    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params,
    });
    let line = serde_json::to_string(&req).map_err(|e| e.to_string())? + "\n";
    session
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("failed to write request '{}': {}", method, e))?;
    session.stdin.flush().await.map_err(|e| e.to_string())?;

    loop {
        let mut line = String::new();
        let bytes = session
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        if bytes == 0 {
            return Err(format!("plugin request '{}' ended without a response", method));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let msg: Value = serde_json::from_str(trimmed).map_err(|e| e.to_string())?;
        let id = msg.get("id").and_then(|v| v.as_u64());
        if id != Some(request_id) {
            continue;
        }
        if let Some(error) = msg.get("error") {
            let message = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown plugin error");
            return Err(message.to_string());
        }
        let result = msg.get("result").cloned().unwrap_or(Value::Null);
        return serde_json::from_value::<T>(result).map_err(|e| e.to_string());
    }
}

async fn shutdown_plugin_session(session: &mut PluginSession) {
    let request_id = session.next_request_id;
    session.next_request_id += 1;
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "shutdown",
        "params": {}
    });
    if let Ok(line) = serde_json::to_string(&req) {
        let _ = session.stdin.write_all((line + "\n").as_bytes()).await;
        let _ = session.stdin.flush().await;
    }
    let _ = session.child.kill().await;
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatQrStartRequest {
    pub base_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatQrStartResponse {
    pub qrcode_url: Option<String>,
    pub message: String,
    pub session_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatQrWaitRequest {
    pub base_url: String,
    pub session_key: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatQrWaitResponse {
    pub connected: bool,
    pub bot_token: Option<String>,
    pub account_id: Option<String>,
    pub base_url: Option<String>,
    pub user_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatQrCancelRequest {
    pub keep_credentials: Option<bool>,
}

pub fn needs_onboarding() -> bool {
    let val = read_settings_value();
    !val.get("onboarded")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

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

#[tauri::command]
pub async fn wechat_qr_start(
    state: State<'_, OnboardingSessions>,
    request: WechatQrStartRequest,
) -> Result<WechatQrStartResponse, String> {
    let mut sessions = state.plugin_sessions.lock().await;
    if let Some(mut existing) = sessions.remove("weixin-openclaw-bridge") {
        shutdown_plugin_session(&mut existing).await;
    }

    let config_value = serde_json::json!({
        "base_url": request.base_url,
    });
    let mut session = spawn_plugin_session("weixin-openclaw-bridge", config_value).await?;

    let result: WechatQrStartResponse = plugin_request(
        &mut session,
        "login_qr_start",
        serde_json::json!({
            "baseUrl": request.base_url,
        }),
    )
    .await?;

    sessions.insert("weixin-openclaw-bridge".to_string(), session);
    Ok(result)
}

#[tauri::command]
pub async fn wechat_qr_wait(
    state: State<'_, OnboardingSessions>,
    request: WechatQrWaitRequest,
) -> Result<WechatQrWaitResponse, String> {
    let mut sessions = state.plugin_sessions.lock().await;
    let session = sessions
        .get_mut("weixin-openclaw-bridge")
        .ok_or_else(|| "wechat onboarding session is not started".to_string())?;

    let result: WechatQrWaitResponse = plugin_request(
        session,
        "login_qr_wait",
        serde_json::json!({
            "baseUrl": request.base_url,
            "sessionKey": request.session_key,
            "timeoutMs": request.timeout_ms,
        }),
    )
    .await?;

    if result.connected {
        if let Some(mut session) = sessions.remove("weixin-openclaw-bridge") {
            shutdown_plugin_session(&mut session).await;
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn wechat_qr_cancel(
    state: State<'_, OnboardingSessions>,
    request: WechatQrCancelRequest,
) -> Result<(), String> {
    let _ = request.keep_credentials;
    let mut sessions = state.plugin_sessions.lock().await;
    if let Some(mut session) = sessions.remove("weixin-openclaw-bridge") {
        shutdown_plugin_session(&mut session).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn finish_onboarding<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, OnboardingSessions>,
    settings: Value,
) -> Result<(), String> {
    let mut sessions = state.plugin_sessions.lock().await;
    for (_, mut session) in sessions.drain() {
        shutdown_plugin_session(&mut session).await;
    }
    drop(sessions);

    let mut val = settings;
    if let Some(obj) = val.as_object_mut() {
        obj.insert("onboarded".into(), serde_json::json!(true));
    }
    write_settings_value(&val)?;

    let _ = app.emit("onboarding-complete", ());

    if let Some(active) = app.try_state::<OnboardingActive>() {
        let was_onboarding = active
            .0
            .swap(false, std::sync::atomic::Ordering::Relaxed);
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
