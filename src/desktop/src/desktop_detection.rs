use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

const DESKTOP_DETECTION_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAppDetectionFile {
    pub schema_version: u32,
    pub platform: String,
    pub scanned_at_unix_ms: u128,
    pub apps: BTreeMap<String, DesktopAppDetection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAppDetection {
    pub installed: bool,
    pub launch_command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<DesktopAppEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAppEntry {
    pub app_name: String,
    pub path: String,
    pub source: String,
    pub source_label: String,
}

pub fn detected_desktop_apps_path() -> PathBuf {
    common::config::data_dir().join("desktop-apps.detected.json")
}

pub fn read_detected_desktop_apps() -> Option<DesktopAppDetectionFile> {
    let path = detected_desktop_apps_path();
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

pub async fn scan_and_persist() -> anyhow::Result<DesktopAppDetectionFile> {
    let detected = scan_desktop_apps().await;
    write_detected_desktop_apps(&detected)?;
    Ok(detected)
}

pub async fn scan_desktop_apps() -> DesktopAppDetectionFile {
    let mut apps = BTreeMap::new();
    for agent in common::resources::AGENTS.iter() {
        if !agent.direct_only || !agent.supports_current_platform() {
            continue;
        }
        let launch_command = agent.pty_command_for_current_platform().to_string();
        let entry = match desktop_app_name(&launch_command) {
            Some(app_name) => desktop_app_entry(&app_name).await,
            None => None,
        };
        apps.insert(
            agent.id.clone(),
            DesktopAppDetection {
                installed: entry.is_some(),
                launch_command,
                entry,
            },
        );
    }
    DesktopAppDetectionFile {
        schema_version: DESKTOP_DETECTION_SCHEMA_VERSION,
        platform: current_platform().to_string(),
        scanned_at_unix_ms: now_unix_ms(),
        apps,
    }
}

async fn desktop_app_entry(app_name: &str) -> Option<DesktopAppEntry> {
    let (path, source, source_label) = if cfg!(target_os = "macos") {
        macos_application_entry(app_name).await?
    } else if cfg!(windows) {
        (
            windows_start_app_id(app_name).await?,
            "windows_start_apps".to_string(),
            "Windows Start Apps".to_string(),
        )
    } else {
        return None;
    };
    Some(DesktopAppEntry {
        app_name: app_name.to_string(),
        path,
        source,
        source_label,
    })
}

fn desktop_app_name(command: &str) -> Option<String> {
    let command = command.trim();
    if cfg!(target_os = "macos") {
        return command
            .strip_prefix("open -a ")
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| name.trim_matches('"').to_string());
    }
    if cfg!(windows) {
        return command
            .strip_prefix("Start-Process ")
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| name.trim_matches('"').to_string());
    }
    None
}

async fn macos_application_entry(app_name: &str) -> Option<(String, String, String)> {
    for path in macos_application_candidate_paths(app_name) {
        if path.is_dir() {
            return Some((
                normalize_app_path(&path),
                "macos_applications_dir".to_string(),
                "macOS Applications directory".to_string(),
            ));
        }
    }

    let bundle_name = macos_app_bundle_name(app_name);
    let query = format!(
        "kMDItemContentTypeTree == 'com.apple.application-bundle' && kMDItemFSName == {}",
        mdfind_string(&bundle_name)
    );
    let path = command_stdout_line("mdfind", &[&query])
        .await
        .filter(|path| path.ends_with(".app"))?;
    Some((
        path.trim_end_matches('/').to_string(),
        "macos_spotlight".to_string(),
        "macOS Spotlight".to_string(),
    ))
}

fn macos_application_candidate_paths(app_name: &str) -> Vec<PathBuf> {
    let bundle_name = macos_app_bundle_name(app_name);
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        roots.insert(1, PathBuf::from(home).join("Applications"));
    }
    roots
        .into_iter()
        .map(|root| root.join(&bundle_name))
        .collect()
}

fn macos_app_bundle_name(app_name: &str) -> String {
    let app_name = app_name.trim().trim_matches('"').trim_end_matches('/');
    if app_name.ends_with(".app") {
        app_name.to_string()
    } else {
        format!("{app_name}.app")
    }
}

fn normalize_app_path(path: &Path) -> String {
    path.to_string_lossy().trim_end_matches('/').to_string()
}

async fn windows_start_app_id(app_name: &str) -> Option<String> {
    let script = format!(
        "$app = Get-StartApps -Name {} | Select-Object -First 1; if ($app) {{ $app.AppID }}",
        powershell_string(app_name)
    );
    command_stdout_line("powershell.exe", &["-NoProfile", "-Command", &script]).await
}

async fn command_stdout_line(command: &str, args: &[&str]) -> Option<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(6),
        Command::new(command).args(args).output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn write_detected_desktop_apps(detected: &DesktopAppDetectionFile) -> anyhow::Result<()> {
    let path = detected_desktop_apps_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create detected desktop apps dir {:?}", parent))?;
    }
    let json = serde_json::to_string_pretty(detected).context("serialize desktop app detection")?;
    std::fs::write(&path, json).with_context(|| format!("write {:?}", path))?;
    Ok(())
}

fn powershell_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn mdfind_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "\\'"))
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_desktop_app_name_parses_open_command() {
        assert_eq!(
            desktop_app_name("open -a Claude").as_deref(),
            Some("Claude")
        );
        assert_eq!(
            desktop_app_name("open -a \"Codex\"").as_deref(),
            Some("Codex")
        );
    }

    #[test]
    fn macos_app_bundle_name_adds_app_suffix_once() {
        assert_eq!(macos_app_bundle_name("Claude"), "Claude.app");
        assert_eq!(macos_app_bundle_name("Codex.app"), "Codex.app");
    }

    #[test]
    fn mdfind_string_quotes_single_quotes() {
        assert_eq!(mdfind_string("Dev's App.app"), "'Dev\\'s App.app'");
    }
}
