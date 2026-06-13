//! Startkit: manifest-driven environment doctor and repair runner.
//!
//! The manifest and scripts live under `src/resources/startkit/`. This module
//! keeps the engine generic: resolve the item graph from user choices, execute
//! platform scripts with a stable environment, and normalize all output into
//! structured item reports for the onboarding UI.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::task::JoinSet;
use tokio::time::sleep;

use crate::agent_detection;

const SETTINGS_TOML: &str = include_str!("../../../resources/startkit/settings.toml");
const STARTKIT_PROGRESS_EVENT: &str = "startkit-progress";
const STARTKIT_COMPLETE_EVENT: &str = "startkit-complete";
const STARTKIT_ITEM_SCAN_TIMEOUT: Duration = Duration::from_secs(8);

pub struct StartkitRunState {
    cancelled: Arc<AtomicBool>,
}

impl Default for StartkitRunState {
    fn default() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub startkit: StartkitInfo,
    #[serde(default)]
    pub runner: RunnerConfig,
    #[serde(default)]
    pub sources: HashMap<String, SourceConfig>,
    #[serde(default, rename = "items")]
    pub items: Vec<StartkitItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartkitInfo {
    pub id: String,
    pub name: String,
    pub schema: u32,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RunnerConfig {
    #[serde(default = "default_timeout_secs")]
    pub default_timeout_secs: u64,
    #[serde(default)]
    pub log_redact_keys: Vec<String>,
}

impl Default for RunnerConfig {
    fn default() -> Self {
        Self {
            default_timeout_secs: default_timeout_secs(),
            log_redact_keys: Vec::new(),
        }
    }
}

fn default_timeout_secs() -> u64 {
    600
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SourceConfig {
    pub label: String,
    pub node_index: String,
    pub node_dist: String,
    pub npm_registry: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartkitItem {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub include_if: Vec<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub managed: bool,
    #[serde(default)]
    pub plugin_dependency: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub min_version: Option<String>,
    #[serde(default)]
    pub program: Option<String>,
    #[serde(default)]
    pub version_arg: Option<String>,
    #[serde(default)]
    pub npm_package: Option<String>,
    #[serde(default)]
    pub settings_key: Option<String>,
    #[serde(default)]
    pub secret: bool,
    #[serde(default)]
    pub detect: Option<PlatformScript>,
    #[serde(default)]
    pub install: Option<PlatformScript>,
    #[serde(default)]
    pub repair: Option<PlatformScript>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlatformScript {
    #[serde(default)]
    pub macos: Option<String>,
    #[serde(default)]
    pub windows: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
}

impl PlatformScript {
    fn for_platform(&self, platform: &str) -> Option<&str> {
        match platform {
            "macos" => self.macos.as_deref(),
            "windows" => self.windows.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartkitChoices {
    #[serde(default)]
    pub agents: Vec<String>,
    #[serde(default = "default_tunnel")]
    pub tunnel: String,
    #[serde(default)]
    pub channels: Vec<String>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_toolchain_mode")]
    pub toolchain_mode: String,
    #[serde(default)]
    pub shell_path: bool,
}

fn default_tunnel() -> String {
    "none".to_string()
}

fn default_source() -> String {
    "global".to_string()
}

fn default_toolchain_mode() -> String {
    "system".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartkitManifestSummary {
    pub id: String,
    pub name: String,
    pub schema: u32,
    pub version: String,
    pub sources: HashMap<String, SourceConfig>,
    pub items: Vec<StartkitItemSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartkitItemSummary {
    pub id: String,
    pub label: String,
    pub group: String,
    pub category: String,
    pub description: Option<String>,
    pub severity: Option<String>,
    pub kind: Option<String>,
    pub managed: bool,
    pub has_repair: bool,
    pub secret: bool,
    pub settings_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartkitPlan {
    pub platform: String,
    pub source: String,
    pub item_ids: Vec<String>,
    pub items: Vec<StartkitItemSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartkitItemStatus {
    Pending,
    Running,
    Ok,
    Missing,
    Outdated,
    Broken,
    NeedsConfig,
    Blocked,
    Error,
    Skipped,
}

impl StartkitItemStatus {
    fn from_script(value: &str) -> Self {
        match value {
            "ok" => Self::Ok,
            "missing" => Self::Missing,
            "outdated" => Self::Outdated,
            "broken" => Self::Broken,
            "needs_config" => Self::NeedsConfig,
            "blocked" => Self::Blocked,
            "skipped" => Self::Skipped,
            _ => Self::Error,
        }
    }

    fn needs_install(&self) -> bool {
        matches!(self, Self::Missing | Self::Outdated | Self::Broken)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartkitItemReport {
    pub id: String,
    pub label: String,
    pub group: String,
    pub category: String,
    pub status: StartkitItemStatus,
    pub severity: Option<String>,
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    pub path: Option<String>,
    pub message: Option<String>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub secret: bool,
    #[serde(default)]
    pub settings_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartkitScanReport {
    pub plan: StartkitPlan,
    pub reports: Vec<StartkitItemReport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartkitProgressEvent {
    pub id: String,
    pub label: String,
    pub status: StartkitItemStatus,
    pub message: Option<String>,
    pub report: Option<StartkitItemReport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartkitCompleteEvent {
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ScriptOutput {
    status: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    latest_version: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    actions: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct StartkitPaths {
    pub root: PathBuf,
    pub home: PathBuf,
    pub node_dir: PathBuf,
    pub cache_dir: PathBuf,
}

impl StartkitPaths {
    pub fn new(root: PathBuf) -> Self {
        let home = common::config::data_dir();
        Self {
            root,
            node_dir: common::process::env::private_node_dir(),
            cache_dir: home.join("cache").join("startkit"),
            home,
        }
    }
}

pub fn load_manifest() -> anyhow::Result<Manifest> {
    toml::from_str(SETTINGS_TOML).context("parsing startkit/settings.toml")
}

#[tauri::command]
pub fn startkit_manifest() -> Result<StartkitManifestSummary, String> {
    manifest_summary().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn startkit_plan(choices: StartkitChoices) -> Result<StartkitPlan, String> {
    plan(&choices, None).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn startkit_scan<R: Runtime>(
    app: AppHandle<R>,
    settings: Value,
    choices: StartkitChoices,
) -> Result<StartkitScanReport, String> {
    scan_with_progress(Some(&app), &settings, &choices, None)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_startkit_install<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, StartkitRunState>,
    settings: Value,
    choices: StartkitChoices,
) -> Result<(), String> {
    state.cancelled.store(false, Ordering::Relaxed);
    common::config::write_settings_json(&settings).map_err(|e| e.to_string())?;

    let cancelled = Arc::clone(&state.cancelled);
    tauri::async_runtime::spawn(async move {
        let status = match run_startkit_install(app.clone(), settings, choices, cancelled).await {
            Ok(status) => status,
            Err(err) => {
                let _ = app.emit(
                    STARTKIT_PROGRESS_EVENT,
                    StartkitProgressEvent {
                        id: "startkit".to_string(),
                        label: "Startkit".to_string(),
                        status: StartkitItemStatus::Error,
                        message: Some(err.to_string()),
                        report: None,
                    },
                );
                "error".to_string()
            }
        };
        let _ = app.emit(STARTKIT_COMPLETE_EVENT, StartkitCompleteEvent { status });
    });

    Ok(())
}

#[tauri::command]
pub async fn cancel_startkit_install(state: State<'_, StartkitRunState>) -> Result<(), String> {
    state.cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

pub fn manifest_summary() -> anyhow::Result<StartkitManifestSummary> {
    let manifest = load_manifest()?;
    Ok(StartkitManifestSummary {
        id: manifest.startkit.id,
        name: manifest.startkit.name,
        schema: manifest.startkit.schema,
        version: manifest.startkit.version,
        sources: manifest.sources,
        items: manifest.items.iter().map(item_summary).collect(),
    })
}

pub fn plan(choices: &StartkitChoices, platform: Option<&str>) -> anyhow::Result<StartkitPlan> {
    let manifest = load_manifest()?;
    plan_from_manifest(&manifest, choices, platform.unwrap_or(current_platform()))
}

#[allow(dead_code)]
pub async fn scan(
    settings: &Value,
    choices: &StartkitChoices,
    platform: Option<&str>,
) -> anyhow::Result<StartkitScanReport> {
    scan_with_progress::<tauri::Wry>(None, settings, choices, platform).await
}

pub(crate) async fn scan_agent_cli_reports(
    settings: &Value,
    choices: &StartkitChoices,
    agent_ids: &[String],
) -> anyhow::Result<Vec<StartkitItemReport>> {
    let _ = settings;
    let manifest = load_manifest()?;
    let mut tasks = JoinSet::new();

    for (index, agent_id) in agent_ids.iter().enumerate() {
        let item_id = format!("agents.{agent_id}.cli");
        let Ok(item) = find_item(&manifest, &item_id).cloned() else {
            continue;
        };
        let agent_id = agent_id.clone();
        let choices = choices.clone();
        tasks.spawn(async move {
            let report = scan_agent_cli_item(&item, &agent_id, &choices).await;
            (index, report)
        });
    }

    let mut reports = Vec::new();
    while let Some(result) = tasks.join_next().await {
        reports.push(result?);
    }
    reports.sort_by_key(|(index, _)| *index);
    Ok(reports.into_iter().map(|(_, report)| report).collect())
}

pub(crate) async fn scan_tunnel_reports(
    settings: &Value,
    choices: &StartkitChoices,
) -> anyhow::Result<Vec<StartkitItemReport>> {
    match choices.tunnel.as_str() {
        "none" => Ok(Vec::new()),
        "ngrok" => Ok(vec![StartkitItemReport {
            id: "tunnels.ngrok.sdk".to_string(),
            label: "Ngrok".to_string(),
            group: "remote".to_string(),
            category: "tunnels".to_string(),
            status: StartkitItemStatus::Ok,
            severity: None,
            version: None,
            latest_version: None,
            path: None,
            message: Some("Ngrok uses the built-in SDK".to_string()),
            actions: Vec::new(),
            secret: false,
            settings_key: None,
        }]),
        "localtunnel" => {
            scan_startkit_item_reports(
                settings,
                choices,
                &["essentials.node".to_string()],
                STARTKIT_ITEM_SCAN_TIMEOUT,
            )
            .await
        }
        _ => {
            let item_id = format!("tunnels.{}.binary", choices.tunnel);
            scan_startkit_item_reports(settings, choices, &[item_id], STARTKIT_ITEM_SCAN_TIMEOUT)
                .await
        }
    }
}

pub(crate) async fn scan_computer_reports(
    settings: &Value,
    choices: &StartkitChoices,
) -> anyhow::Result<Vec<StartkitItemReport>> {
    let manifest = load_manifest()?;
    let platform = current_platform();
    let plan = plan_from_manifest(&manifest, choices, platform)?;
    let item_ids = plan
        .item_ids
        .into_iter()
        .filter(|id| matches!(id.as_str(), "essentials.node" | "essentials.git"))
        .collect::<Vec<_>>();
    scan_startkit_item_reports(settings, choices, &item_ids, STARTKIT_ITEM_SCAN_TIMEOUT).await
}

async fn scan_startkit_item_reports(
    settings: &Value,
    choices: &StartkitChoices,
    item_ids: &[String],
    max_duration: Duration,
) -> anyhow::Result<Vec<StartkitItemReport>> {
    let manifest = load_manifest()?;
    let platform = current_platform().to_string();
    let paths = StartkitPaths::new(startkit_root());
    let mut tasks = JoinSet::new();

    for (index, item_id) in item_ids.iter().enumerate() {
        let Ok(item) = find_item(&manifest, item_id).cloned() else {
            continue;
        };
        let manifest = manifest.clone();
        let paths = paths.clone();
        let settings = settings.clone();
        let choices = choices.clone();
        let platform = platform.clone();
        tasks.spawn(async move {
            let report = tokio::time::timeout(
                max_duration,
                scan_item(&manifest, &paths, &item, &settings, &choices, &platform),
            )
            .await
            .unwrap_or_else(|_| StartkitItemReport {
                status: StartkitItemStatus::Error,
                message: Some("Check timed out".to_string()),
                actions: Vec::new(),
                ..base_report(&item)
            });
            (index, report)
        });
    }

    let mut reports = Vec::new();
    while let Some(result) = tasks.join_next().await {
        reports.push(result?);
    }
    reports.sort_by_key(|(index, _)| *index);
    Ok(reports.into_iter().map(|(_, report)| report).collect())
}

async fn scan_with_progress<R: Runtime>(
    app: Option<&AppHandle<R>>,
    settings: &Value,
    choices: &StartkitChoices,
    platform: Option<&str>,
) -> anyhow::Result<StartkitScanReport> {
    let manifest = load_manifest()?;
    let platform = platform.unwrap_or(current_platform());
    let plan = plan_from_manifest(&manifest, choices, platform)?;
    let paths = StartkitPaths::new(startkit_root());
    let mut reports = Vec::new();

    for item_id in &plan.item_ids {
        let item = find_item(&manifest, item_id)?;
        if let Some(app) = app {
            emit_progress(
                app,
                item,
                StartkitItemStatus::Running,
                Some("Checking".to_string()),
                None,
            );
        }
        let report = scan_item(&manifest, &paths, item, settings, choices, platform).await;
        if let Some(app) = app {
            emit_progress(
                app,
                item,
                report.status.clone(),
                report.message.clone(),
                Some(report.clone()),
            );
        }
        reports.push(report);
    }

    Ok(StartkitScanReport { plan, reports })
}

#[allow(dead_code)]
pub async fn execute_item(
    settings: &Value,
    choices: &StartkitChoices,
    item_id: &str,
) -> anyhow::Result<StartkitItemReport> {
    execute_item_with_cancel(settings, choices, item_id, None, None).await
}

async fn execute_item_with_cancel(
    settings: &Value,
    choices: &StartkitChoices,
    item_id: &str,
    cancelled: Option<&Arc<AtomicBool>>,
    progress: Option<&(dyn Fn(&StartkitItem, StartkitItemStatus, Option<String>) + Sync)>,
) -> anyhow::Result<StartkitItemReport> {
    let manifest = load_manifest()?;
    let platform = current_platform();
    let paths = StartkitPaths::new(startkit_root());
    let item = find_item(&manifest, item_id)?;
    if let Some(agent_id) = agent_id_from_cli_item(&item.id) {
        return Ok(scan_agent_cli_item(item, agent_id, choices).await);
    }
    let before = scan_item(&manifest, &paths, item, settings, choices, platform).await;

    if !before.status.needs_install() {
        return Ok(before);
    }

    let Some(script) = &item.install else {
        return Ok(StartkitItemReport {
            status: StartkitItemStatus::Blocked,
            message: Some("No automatic install action is available".to_string()),
            ..base_report(item)
        });
    };

    let Some(script_path) = script.for_platform(platform) else {
        return Ok(StartkitItemReport {
            status: StartkitItemStatus::Blocked,
            message: Some(format!("No install script for {platform}")),
            ..base_report(item)
        });
    };

    if let Some(progress) = progress {
        progress(
            item,
            StartkitItemStatus::Running,
            Some(install_phase_message(item)),
        );
    }

    match run_script(
        &manifest,
        &paths,
        item,
        choices,
        platform,
        script_path,
        script,
        cancelled,
    )
    .await
    {
        Ok(report) => report_from_script(item, report),
        Err(err) => StartkitItemReport {
            status: StartkitItemStatus::Error,
            message: Some(err.to_string()),
            ..base_report(item)
        },
    }
    .pipe(Ok)
}

async fn run_startkit_install<R: Runtime>(
    app: AppHandle<R>,
    settings: Value,
    choices: StartkitChoices,
    cancelled: Arc<AtomicBool>,
) -> anyhow::Result<String> {
    let manifest = load_manifest()?;
    let platform = current_platform();
    let plan = plan_from_manifest(&manifest, &choices, platform)?;
    let mut had_error = false;
    let mut needs_input = false;

    for item_id in &plan.item_ids {
        if cancelled.load(Ordering::Relaxed) {
            return Ok("cancelled".to_string());
        }

        let item = find_item(&manifest, item_id)?;
        let report = if item.kind.as_deref() == Some("builtin_agent_adapters") {
            run_agent_adapters_item(&app, item, &choices, &cancelled).await
        } else if item.kind.as_deref() == Some("builtin_channel_plugins") {
            run_channel_plugins_item(&app, item, &choices, &cancelled).await
        } else {
            let progress =
                |item: &StartkitItem, status: StartkitItemStatus, message: Option<String>| {
                    emit_progress(&app, item, status, message, None);
                };
            execute_item_with_cancel(
                &settings,
                &choices,
                item_id,
                Some(&cancelled),
                Some(&progress),
            )
            .await
        };

        match report {
            Ok(report) => {
                if matches!(
                    report.status,
                    StartkitItemStatus::Error | StartkitItemStatus::Blocked
                ) {
                    had_error = true;
                }
                if matches!(report.status, StartkitItemStatus::NeedsConfig) {
                    needs_input = true;
                }
                emit_progress(
                    &app,
                    item,
                    report.status.clone(),
                    report.message.clone(),
                    Some(report),
                );
            }
            Err(err) => {
                had_error = true;
                emit_progress(
                    &app,
                    item,
                    StartkitItemStatus::Error,
                    Some(err.to_string()),
                    None,
                );
            }
        }
    }

    Ok(if cancelled.load(Ordering::Relaxed) {
        "cancelled"
    } else if had_error {
        "error"
    } else if needs_input {
        "needs_input"
    } else {
        "complete"
    }
    .to_string())
}

async fn run_channel_plugins_item<R: Runtime>(
    app: &AppHandle<R>,
    item: &StartkitItem,
    choices: &StartkitChoices,
    cancelled: &Arc<AtomicBool>,
) -> anyhow::Result<StartkitItemReport> {
    if choices.channels.is_empty() {
        return Ok(StartkitItemReport {
            status: StartkitItemStatus::Skipped,
            message: Some("No channel plugins selected".to_string()),
            ..base_report(item)
        });
    }

    for channel_id in &choices.channels {
        if cancelled.load(Ordering::Relaxed) {
            return Ok(StartkitItemReport {
                status: StartkitItemStatus::Skipped,
                message: Some("Cancelled".to_string()),
                ..base_report(item)
            });
        }
        install_channel_plugin(app, channel_id, cancelled).await?;
    }

    Ok(StartkitItemReport {
        status: StartkitItemStatus::Ok,
        message: Some("Channel plugins are ready".to_string()),
        actions: Vec::new(),
        ..base_report(item)
    })
}

async fn run_agent_adapters_item<R: Runtime>(
    app: &AppHandle<R>,
    item: &StartkitItem,
    choices: &StartkitChoices,
    cancelled: &Arc<AtomicBool>,
) -> anyhow::Result<StartkitItemReport> {
    let agent_ids = npm_adapter_agent_ids(choices);
    if agent_ids.is_empty() {
        return Ok(StartkitItemReport {
            status: StartkitItemStatus::Skipped,
            message: Some("No npm ACP adapters selected".to_string()),
            actions: Vec::new(),
            ..base_report(item)
        });
    }

    for agent_id in agent_ids {
        if cancelled.load(Ordering::Relaxed) {
            return Ok(StartkitItemReport {
                status: StartkitItemStatus::Skipped,
                message: Some("Cancelled".to_string()),
                ..base_report(item)
            });
        }
        install_acp_adapter_for_agent(app, &agent_id, cancelled).await?;
    }

    Ok(StartkitItemReport {
        status: StartkitItemStatus::Ok,
        message: Some("Agent ACP adapters are ready".to_string()),
        actions: Vec::new(),
        ..base_report(item)
    })
}

async fn install_acp_adapter_for_agent<R: Runtime>(
    app: &AppHandle<R>,
    agent_id: &str,
    cancelled: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let Some(agent_def) = common::resources::agent_by_id(agent_id) else {
        return Ok(());
    };
    let Some(npm_pkg) = agent_def.acp.npm_package.as_deref() else {
        return Ok(());
    };
    let progress_id = format!("agents.{agent_id}.sdk");
    let progress_label = format!("{} ACP adapter", agent_def.display_name);
    let default_bin_name = common::agent::npm_package_bin_name(npm_pkg);
    let bin_name = agent_def
        .acp
        .bin_name
        .as_deref()
        .unwrap_or(&default_bin_name);

    if common::agent::npm_package_installed(npm_pkg, bin_name) {
        emit_progress_event(
            app,
            progress_id,
            progress_label,
            StartkitItemStatus::Ok,
            Some(format!(
                "{} ACP adapter already installed",
                agent_def.display_name
            )),
            None,
        );
        return Ok(());
    }

    emit_progress_event(
        app,
        progress_id.clone(),
        progress_label.clone(),
        StartkitItemStatus::Running,
        Some(format!("Installing {} ACP adapter", agent_def.display_name)),
        None,
    );

    let result = common::agent::auto_install_npm_agent_with_progress_and_cancel(
        npm_pkg,
        |line| {
            emit_progress_event(
                app,
                progress_id.clone(),
                progress_label.clone(),
                StartkitItemStatus::Running,
                Some(line),
                None,
            );
        },
        || cancelled.load(Ordering::Relaxed),
    )
    .await;

    match result {
        Ok(_) => {
            emit_progress_event(
                app,
                progress_id,
                progress_label,
                StartkitItemStatus::Ok,
                Some("ACP adapter is installed".to_string()),
                None,
            );
            Ok(())
        }
        Err(error) => {
            emit_progress_event(
                app,
                progress_id,
                progress_label,
                StartkitItemStatus::Error,
                Some(error.to_string()),
                None,
            );
            Err(error)
        }
    }
}

async fn install_channel_plugin<R: Runtime>(
    app: &AppHandle<R>,
    channel_id: &str,
    cancelled: &Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let progress_id = format!("channels.plugins.{channel_id}");
    if crate::onboarding::check_plugin_status(channel_id.to_string()) == "ready" {
        emit_progress_event(
            app,
            progress_id,
            channel_id.to_string(),
            StartkitItemStatus::Ok,
            Some(format!("{channel_id} plugin already installed")),
            None,
        );
        return Ok(());
    }

    let plugin = common::resources::plugin_by_id(channel_id)
        .ok_or_else(|| anyhow!("channel plugin '{channel_id}' not found in registry"))?;

    emit_progress_event(
        app,
        progress_id.clone(),
        plugin.name.clone(),
        StartkitItemStatus::Running,
        Some(format!("Installing {} plugin", plugin.name)),
        None,
    );

    let result = crate::onboarding::plugin_install::run_install_inner_with_progress(
        crate::onboarding::plugin_install::InstallPluginRequest {
            plugin_id: channel_id.to_string(),
            github_url: plugin.github.clone(),
        },
        |line| {
            emit_progress_event(
                app,
                progress_id.clone(),
                plugin.name.clone(),
                StartkitItemStatus::Running,
                Some(line),
                None,
            );
        },
        || cancelled.load(Ordering::Relaxed),
    )
    .await;

    match result {
        Ok(_) => {
            emit_progress_event(
                app,
                progress_id,
                plugin.name.clone(),
                StartkitItemStatus::Ok,
                Some("Plugin is installed".to_string()),
                None,
            );
            Ok(())
        }
        Err(error) => {
            emit_progress_event(
                app,
                progress_id,
                plugin.name.clone(),
                StartkitItemStatus::Error,
                Some(error.to_string()),
                None,
            );
            Err(error)
        }
    }
}

fn install_phase_message(item: &StartkitItem) -> String {
    match item.id.as_str() {
        "essentials.node" => "Downloading Node.js".to_string(),
        "tunnels.cloudflare.binary" => "Installing cloudflared".to_string(),
        _ => format!("Installing {}", item.label),
    }
}

fn emit_progress<R: Runtime>(
    app: &AppHandle<R>,
    item: &StartkitItem,
    status: StartkitItemStatus,
    message: Option<String>,
    report: Option<StartkitItemReport>,
) {
    emit_progress_event(
        app,
        item.id.clone(),
        item.label.clone(),
        status,
        message,
        report,
    );
}

fn emit_progress_event<R: Runtime>(
    app: &AppHandle<R>,
    id: String,
    label: String,
    status: StartkitItemStatus,
    message: Option<String>,
    report: Option<StartkitItemReport>,
) {
    let _ = app.emit(
        STARTKIT_PROGRESS_EVENT,
        StartkitProgressEvent {
            id,
            label,
            status,
            message,
            report,
        },
    );
}

async fn scan_item(
    manifest: &Manifest,
    paths: &StartkitPaths,
    item: &StartkitItem,
    settings: &Value,
    choices: &StartkitChoices,
    platform: &str,
) -> StartkitItemReport {
    if let Some(agent_id) = agent_id_from_cli_item(&item.id) {
        return scan_agent_cli_item(item, agent_id, choices).await;
    }

    if item.kind.as_deref() == Some("config") {
        return scan_config_item(item, settings);
    }

    if item.kind.as_deref() == Some("builtin_agent_adapters") {
        return scan_agent_adapters_item(item, choices);
    }

    if item.kind.as_deref() == Some("builtin_channel_plugins") {
        let status = if choices.channels.is_empty() {
            StartkitItemStatus::Skipped
        } else {
            StartkitItemStatus::Pending
        };
        return StartkitItemReport {
            status,
            message: Some(format!(
                "{} channel plugin(s) selected",
                choices.channels.len()
            )),
            actions: if choices.channels.is_empty() {
                Vec::new()
            } else {
                vec!["install".to_string()]
            },
            ..base_report(item)
        };
    }

    let Some(detect) = &item.detect else {
        return StartkitItemReport {
            status: StartkitItemStatus::Pending,
            message: Some("No detect script configured".to_string()),
            ..base_report(item)
        };
    };

    let Some(script_path) = detect.for_platform(platform) else {
        return StartkitItemReport {
            status: StartkitItemStatus::Blocked,
            message: Some(format!("No detect script for {platform}")),
            ..base_report(item)
        };
    };

    match run_script(
        manifest,
        paths,
        item,
        choices,
        platform,
        script_path,
        detect,
        None,
    )
    .await
    {
        Ok(output) => report_from_script(item, output),
        Err(err) => StartkitItemReport {
            status: StartkitItemStatus::Error,
            message: Some(err.to_string()),
            ..base_report(item)
        },
    }
}

fn scan_agent_adapters_item(item: &StartkitItem, choices: &StartkitChoices) -> StartkitItemReport {
    let agent_ids = npm_adapter_agent_ids(choices);
    if agent_ids.is_empty() {
        return StartkitItemReport {
            status: StartkitItemStatus::Skipped,
            message: Some("No npm ACP adapters selected".to_string()),
            actions: Vec::new(),
            ..base_report(item)
        };
    }

    let missing = agent_ids
        .iter()
        .filter(|agent_id| !agent_adapter_installed(agent_id))
        .count();
    if missing == 0 {
        return StartkitItemReport {
            status: StartkitItemStatus::Ok,
            message: Some("Agent ACP adapters are ready".to_string()),
            actions: Vec::new(),
            ..base_report(item)
        };
    }

    StartkitItemReport {
        status: StartkitItemStatus::Missing,
        message: Some(format!(
            "{} of {} agent ACP adapter(s) will be installed",
            missing,
            agent_ids.len()
        )),
        actions: vec!["install".to_string()],
        ..base_report(item)
    }
}

fn npm_adapter_agent_ids(choices: &StartkitChoices) -> Vec<String> {
    choices
        .agents
        .iter()
        .filter(|agent_id| {
            common::resources::agent_by_id(agent_id)
                .and_then(|agent| agent.acp.npm_package.as_deref())
                .is_some()
        })
        .cloned()
        .collect()
}

fn agent_adapter_installed(agent_id: &str) -> bool {
    let Some(agent) = common::resources::agent_by_id(agent_id) else {
        return true;
    };
    let Some(npm_pkg) = agent.acp.npm_package.as_deref() else {
        return true;
    };
    let default_bin_name = common::agent::npm_package_bin_name(npm_pkg);
    let bin_name = agent.acp.bin_name.as_deref().unwrap_or(&default_bin_name);
    common::agent::npm_package_installed(npm_pkg, bin_name)
}

async fn scan_agent_cli_item(
    item: &StartkitItem,
    agent_id: &str,
    _choices: &StartkitChoices,
) -> StartkitItemReport {
    let selected = agent_detection::scan_agent_and_persist(agent_id)
        .await
        .ok()
        .and_then(|detection| {
            agent_detection::preferred_candidate_for_toolchain_mode(&detection, "system")
        });

    match selected {
        Some(candidate) => StartkitItemReport {
            status: StartkitItemStatus::Ok,
            version: candidate.version,
            path: Some(candidate.path),
            message: Some(format!(
                "{} selected from {}",
                item.label, candidate.source_label
            )),
            actions: Vec::new(),
            ..base_report(item)
        },
        None => StartkitItemReport {
            status: StartkitItemStatus::Blocked,
            message: Some(agent_missing_message(item)),
            actions: Vec::new(),
            ..base_report(item)
        },
    }
}

fn agent_missing_message(item: &StartkitItem) -> String {
    format!(
        "{} was not found in the system toolchain. Install it on this computer, then scan again.",
        item.label
    )
}

fn agent_id_from_cli_item(item_id: &str) -> Option<&str> {
    item_id
        .strip_prefix("agents.")
        .and_then(|value| value.strip_suffix(".cli"))
}

fn scan_config_item(item: &StartkitItem, settings: &Value) -> StartkitItemReport {
    let has_value = item
        .settings_key
        .as_deref()
        .and_then(|key| settings_path_value(settings, key))
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    StartkitItemReport {
        status: if has_value {
            StartkitItemStatus::Ok
        } else {
            StartkitItemStatus::NeedsConfig
        },
        message: Some(if has_value {
            "Configured".to_string()
        } else {
            "Needs configuration".to_string()
        }),
        actions: if has_value {
            Vec::new()
        } else {
            vec!["configure".to_string()]
        },
        ..base_report(item)
    }
}

async fn run_script(
    manifest: &Manifest,
    paths: &StartkitPaths,
    item: &StartkitItem,
    choices: &StartkitChoices,
    platform: &str,
    script_path: &str,
    script: &PlatformScript,
    cancelled: Option<&Arc<AtomicBool>>,
) -> anyhow::Result<ScriptOutput> {
    let full_path = paths.root.join(script_path);
    if !full_path.exists() {
        bail!("script not found: {}", full_path.display());
    }

    let mut command = if platform == "windows" {
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
        cmd.arg(&full_path);
        cmd
    } else {
        let mut cmd = Command::new("sh");
        cmd.arg(&full_path);
        cmd
    };

    command.args(&script.args);
    command.env_clear();
    command.envs(common::process::env::enriched_env().clone());
    apply_startkit_env(&mut command, manifest, paths, item, choices)?;
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let output = run_command_with_cancel(
        command,
        Duration::from_secs(manifest.runner.default_timeout_secs),
        cancelled,
    )
    .await
    .context("running startkit script")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let line = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .ok_or_else(|| {
            anyhow!(
                "script did not emit JSON{}",
                if stderr.trim().is_empty() {
                    String::new()
                } else {
                    format!(": {}", redact(&stderr, &manifest.runner.log_redact_keys))
                }
            )
        })?;

    let parsed: ScriptOutput =
        serde_json::from_str(line).with_context(|| format!("parsing script JSON: {line}"))?;
    Ok(parsed)
}

async fn run_command_with_cancel(
    mut command: Command,
    max_duration: Duration,
    cancelled: Option<&Arc<AtomicBool>>,
) -> anyhow::Result<std::process::Output> {
    let mut child = command.spawn().context("spawning startkit script")?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("startkit script stdout was not captured"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("startkit script stderr was not captured"))?;

    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        stdout.read_to_end(&mut buf).await.map(|_| buf)
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        stderr.read_to_end(&mut buf).await.map(|_| buf)
    });

    let started = Instant::now();
    let status = loop {
        if cancelled
            .map(|flag| flag.load(Ordering::Relaxed))
            .unwrap_or(false)
        {
            let _ = child.kill().await;
            bail!("cancelled");
        }
        if started.elapsed() >= max_duration {
            let _ = child.kill().await;
            bail!("startkit script timed out");
        }
        if let Some(status) = child.try_wait().context("polling startkit script")? {
            break status;
        }
        sleep(Duration::from_millis(200)).await;
    };

    let stdout = stdout_task
        .await
        .context("joining startkit stdout reader")?
        .context("reading startkit stdout")?;
    let stderr = stderr_task
        .await
        .context("joining startkit stderr reader")?
        .context("reading startkit stderr")?;

    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

fn apply_startkit_env(
    command: &mut Command,
    manifest: &Manifest,
    paths: &StartkitPaths,
    item: &StartkitItem,
    choices: &StartkitChoices,
) -> anyhow::Result<()> {
    std::fs::create_dir_all(&paths.cache_dir).ok();

    let source = manifest
        .sources
        .get(&choices.source)
        .or_else(|| manifest.sources.get("global"))
        .ok_or_else(|| anyhow!("startkit source '{}' not found", choices.source))?;

    command.env("STARTKIT_HOME", &paths.home);
    command.env("STARTKIT_ROOT", &paths.root);
    command.env("STARTKIT_NODE_DIR", &paths.node_dir);
    command.env("STARTKIT_CACHE_DIR", &paths.cache_dir);
    command.env("STARTKIT_SOURCE", &choices.source);
    command.env(
        "STARTKIT_ITEM_MANAGED",
        if item.managed { "true" } else { "false" },
    );
    command.env("STARTKIT_NPM_REGISTRY", &source.npm_registry);
    command.env("STARTKIT_NODE_INDEX_URL", &source.node_index);
    command.env("STARTKIT_NODE_DIST_BASE", &source.node_dist);
    command.env(
        "STARTKIT_CAN_INSTALL",
        if item.install.is_some() {
            "true"
        } else {
            "false"
        },
    );
    command.env("STARTKIT_ITEM_ID", &item.id);
    if let Some(value) = &item.min_version {
        command.env("STARTKIT_MIN_VERSION", value);
    }
    if let Some(value) = &item.program {
        command.env("STARTKIT_PROGRAM", value);
    }
    if let Some(value) = &item.version_arg {
        command.env("STARTKIT_VERSION_ARG", value);
    }
    if let Some(value) = &item.npm_package {
        command.env("STARTKIT_NPM_PACKAGE", value);
    }
    if let Some(value) = &item.plugin_dependency {
        let plugin_dir = common::plugins::user_plugin_dependency_dir(value);
        let plugin_bin_dir = plugin_dir.join("bin");
        std::fs::create_dir_all(&plugin_bin_dir).ok();
        command.env("STARTKIT_PLUGIN_DIR", plugin_dir);
        command.env("STARTKIT_PLUGIN_BIN_DIR", plugin_bin_dir);
    }

    Ok(())
}

fn report_from_script(item: &StartkitItem, output: ScriptOutput) -> StartkitItemReport {
    StartkitItemReport {
        status: StartkitItemStatus::from_script(&output.status),
        version: output.version,
        latest_version: output.latest_version,
        path: output.path,
        message: output.message,
        actions: output.actions,
        ..base_report(item)
    }
}

fn base_report(item: &StartkitItem) -> StartkitItemReport {
    StartkitItemReport {
        id: item.id.clone(),
        label: item.label.clone(),
        group: item.group.clone(),
        category: item.category.clone(),
        status: StartkitItemStatus::Pending,
        severity: item.severity.clone(),
        version: None,
        latest_version: None,
        path: None,
        message: None,
        actions: Vec::new(),
        secret: item.secret,
        settings_key: item.settings_key.clone(),
    }
}

fn item_summary(item: &StartkitItem) -> StartkitItemSummary {
    StartkitItemSummary {
        id: item.id.clone(),
        label: item.label.clone(),
        group: item.group.clone(),
        category: item.category.clone(),
        description: item.description.clone(),
        severity: item.severity.clone(),
        kind: item.kind.clone(),
        managed: item.managed,
        has_repair: item.repair.is_some(),
        secret: item.secret,
        settings_key: item.settings_key.clone(),
    }
}

fn plan_from_manifest(
    manifest: &Manifest,
    choices: &StartkitChoices,
    platform: &str,
) -> anyhow::Result<StartkitPlan> {
    let by_id: HashMap<&str, &StartkitItem> = manifest
        .items
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect();
    let mut selected = HashSet::<String>::new();

    for item in &manifest.items {
        if !supports_platform(item, platform) {
            continue;
        }
        if should_include(item, choices) {
            add_with_deps(item, &by_id, platform, &mut selected)?;
        }
    }

    let mut ordered = Vec::new();
    let mut temporary = HashSet::new();
    let mut permanent = HashSet::new();
    for id in selected.iter() {
        visit(
            id,
            &by_id,
            platform,
            &selected,
            &mut temporary,
            &mut permanent,
            &mut ordered,
        )?;
    }

    let items = ordered
        .iter()
        .map(|id| item_summary(find_item(manifest, id).expect("planned item exists")))
        .collect();

    Ok(StartkitPlan {
        platform: platform.to_string(),
        source: choices.source.clone(),
        item_ids: ordered,
        items,
    })
}

fn add_with_deps(
    item: &StartkitItem,
    by_id: &HashMap<&str, &StartkitItem>,
    platform: &str,
    selected: &mut HashSet<String>,
) -> anyhow::Result<()> {
    selected.insert(item.id.clone());
    for dep in &item.depends_on {
        let dep_item = by_id
            .get(dep.as_str())
            .ok_or_else(|| anyhow!("startkit item '{}' depends on missing '{}'", item.id, dep))?;
        if !supports_platform(dep_item, platform) {
            continue;
        }
        add_with_deps(dep_item, by_id, platform, selected)?;
    }
    Ok(())
}

fn visit(
    id: &str,
    by_id: &HashMap<&str, &StartkitItem>,
    platform: &str,
    selected: &HashSet<String>,
    temporary: &mut HashSet<String>,
    permanent: &mut HashSet<String>,
    ordered: &mut Vec<String>,
) -> anyhow::Result<()> {
    if permanent.contains(id) {
        return Ok(());
    }
    if !temporary.insert(id.to_string()) {
        bail!("cycle in startkit item dependencies at '{id}'");
    }
    let item = by_id
        .get(id)
        .ok_or_else(|| anyhow!("planned startkit item missing: {id}"))?;
    for dep in &item.depends_on {
        if selected.contains(dep) {
            let dep_item = by_id.get(dep.as_str()).ok_or_else(|| {
                anyhow!("startkit item '{}' depends on missing '{}'", item.id, dep)
            })?;
            if supports_platform(dep_item, platform) {
                visit(
                    dep, by_id, platform, selected, temporary, permanent, ordered,
                )?;
            }
        }
    }
    temporary.remove(id);
    permanent.insert(id.to_string());
    ordered.push(id.to_string());
    Ok(())
}

fn should_include(item: &StartkitItem, choices: &StartkitChoices) -> bool {
    item.include_if.iter().any(|rule| match rule.as_str() {
        "always" => true,
        "agent:any" => !choices.agents.is_empty(),
        "agent:npm_adapter" => !npm_adapter_agent_ids(choices).is_empty(),
        "channels:any" => !choices.channels.is_empty(),
        "tunnel:any" => choices.tunnel != "none",
        "shell_path:true" => choices.shell_path,
        rule if rule.starts_with("agent:") => {
            let agent = &rule["agent:".len()..];
            choices.agents.iter().any(|id| id == agent)
        }
        rule if rule.starts_with("tunnel:") => {
            let tunnel = &rule["tunnel:".len()..];
            choices.tunnel == tunnel
        }
        _ => false,
    })
}

fn supports_platform(item: &StartkitItem, platform: &str) -> bool {
    item.platforms.is_empty() || item.platforms.iter().any(|p| p == platform)
}

fn find_item<'a>(manifest: &'a Manifest, id: &str) -> anyhow::Result<&'a StartkitItem> {
    manifest
        .items
        .iter()
        .find(|item| item.id == id)
        .ok_or_else(|| anyhow!("unknown startkit item: {id}"))
}

fn settings_path_value<'a>(settings: &'a Value, key: &str) -> Option<&'a Value> {
    let mut current = settings;
    for part in key.split('.') {
        current = current.get(part)?;
    }
    Some(current)
}

pub fn current_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        other => other,
    }
}

fn startkit_root() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/startkit")
    }
    #[cfg(not(debug_assertions))]
    {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        for candidate in [
            exe_dir.join("_up_").join("resources").join("startkit"),
            exe_dir
                .join("..")
                .join("Resources")
                .join("_up_")
                .join("resources")
                .join("startkit"),
            exe_dir.join("resources").join("startkit"),
        ] {
            if candidate.exists() {
                return candidate;
            }
        }
        exe_dir.join("_up_").join("resources").join("startkit")
    }
}

fn redact(value: &str, keys: &[String]) -> String {
    let mut out = value.to_string();
    for key in keys {
        if key.is_empty() {
            continue;
        }
        out = out.replace(key, "***");
    }
    out
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}

impl<T> Pipe for T {}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(choices: StartkitChoices) -> Vec<String> {
        let manifest = load_manifest().unwrap();
        plan_from_manifest(&manifest, &choices, "macos")
            .unwrap()
            .item_ids
    }

    #[test]
    fn codex_only_plan_does_not_install_claude_or_tunnel() {
        let item_ids = ids(StartkitChoices {
            agents: vec!["codex".to_string()],
            tunnel: "none".to_string(),
            channels: Vec::new(),
            source: "global".to_string(),
            toolchain_mode: "system".to_string(),
            shell_path: false,
        });

        assert!(item_ids.contains(&"essentials.node".to_string()));
        assert!(item_ids.contains(&"agents.adapters".to_string()));
        assert!(!item_ids.contains(&"essentials.git".to_string()));
        assert!(item_ids.contains(&"agents.codex.cli".to_string()));
        assert!(!item_ids.contains(&"agents.claude.cli".to_string()));
        assert!(!item_ids.contains(&"tunnels.cloudflare.binary".to_string()));
    }

    #[test]
    fn non_npm_agent_does_not_pull_node_or_adapter() {
        let item_ids = ids(StartkitChoices {
            agents: vec!["qwen-code".to_string()],
            tunnel: "none".to_string(),
            channels: Vec::new(),
            source: "global".to_string(),
            toolchain_mode: "system".to_string(),
            shell_path: false,
        });

        assert!(!item_ids.contains(&"essentials.node".to_string()));
        assert!(!item_ids.contains(&"agents.adapters".to_string()));
        assert!(!item_ids.contains(&"essentials.git".to_string()));
        assert!(item_ids.contains(&"agents.qwen-code.cli".to_string()));
    }

    #[test]
    fn cloudflare_plan_includes_binary_and_config_without_agents() {
        let manifest = load_manifest().unwrap();
        let item_ids = ids(StartkitChoices {
            agents: Vec::new(),
            tunnel: "cloudflare".to_string(),
            channels: Vec::new(),
            source: "cn".to_string(),
            toolchain_mode: "system".to_string(),
            shell_path: false,
        });

        assert_eq!(
            item_ids,
            vec![
                "tunnels.cloudflare.binary",
                "tunnels.cloudflare.token",
                "tunnels.cloudflare.hostname"
            ]
        );
        let cloudflare = find_item(&manifest, "tunnels.cloudflare.binary").unwrap();
        assert_eq!(
            cloudflare.plugin_dependency.as_deref(),
            Some("tunnel-cloudflare")
        );
    }

    #[test]
    fn channels_pull_node_and_git() {
        let item_ids = ids(StartkitChoices {
            agents: Vec::new(),
            tunnel: "none".to_string(),
            channels: vec!["telegram".to_string()],
            source: "global".to_string(),
            toolchain_mode: "system".to_string(),
            shell_path: false,
        });

        assert!(item_ids.contains(&"essentials.node".to_string()));
        assert!(item_ids.contains(&"essentials.git".to_string()));
        assert!(item_ids.contains(&"channels.plugins".to_string()));
        assert!(!item_ids.contains(&"agents.adapters".to_string()));
    }

    #[test]
    fn startkit_choices_default_to_system_toolchain() {
        let choices: StartkitChoices = serde_json::from_value(serde_json::json!({
            "agents": ["codex"],
            "tunnel": "none",
            "channels": [],
            "source": "global"
        }))
        .unwrap();

        assert_eq!(choices.toolchain_mode, "system");
        assert!(!choices.shell_path);
    }

    #[test]
    fn shell_path_choice_no_longer_adds_environment_item() {
        let item_ids = ids(StartkitChoices {
            agents: vec!["codex".to_string()],
            tunnel: "none".to_string(),
            channels: Vec::new(),
            source: "global".to_string(),
            toolchain_mode: "system".to_string(),
            shell_path: true,
        });

        assert!(!item_ids.contains(&"environment.shell_path".to_string()));
    }
}
