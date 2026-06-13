use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::task::JoinSet;

const AGENT_SOURCES_TOML: &str = include_str!("../../resources/agent-sources.toml");
const DETECTION_SCHEMA_VERSION: u32 = 1;
const VERSION_CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const NON_PATH_CANDIDATE_RANK_BASE: u32 = 5_000;

#[derive(Debug, Clone, Deserialize)]
pub struct AgentSourceCatalog {
    #[serde(default)]
    pub agents: BTreeMap<String, AgentCommandSpec>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentCommandSpec {
    pub program: String,
    #[serde(default = "default_version_arg")]
    pub version_arg: String,
    #[serde(default)]
    pub sources: BTreeMap<String, AgentSourceSpec>,
}

fn default_version_arg() -> String {
    "--version".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentSourceSpec {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub package: Option<String>,
    #[serde(default)]
    pub install: PlatformCommand,
    #[serde(default)]
    pub upgrade: PlatformCommand,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct PlatformCommand {
    #[serde(default)]
    pub macos: Option<String>,
    #[serde(default)]
    pub linux: Option<String>,
    #[serde(default)]
    pub windows: Option<String>,
}

impl PlatformCommand {
    pub fn for_current_platform(&self) -> Option<&str> {
        match current_platform() {
            "macos" => self.macos.as_deref(),
            "linux" => self.linux.as_deref(),
            "windows" => self.windows.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetectionFile {
    pub schema_version: u32,
    pub platform: String,
    pub scanned_at_unix_ms: u128,
    pub agents: BTreeMap<String, AgentDetection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetection {
    #[serde(rename = "default", default)]
    pub default_candidate: Option<AgentCandidate>,
    #[serde(default)]
    pub system_selected: Option<AgentCandidate>,
    #[serde(default, rename = "selected", skip_serializing)]
    pub legacy_selected: Option<AgentCandidate>,
    #[serde(default)]
    pub candidates: Vec<AgentCandidate>,
}

impl AgentDetection {
    pub fn system_selected_candidate(&self) -> Option<AgentCandidate> {
        self.system_selected
            .clone()
            .filter(is_system_path_candidate)
            .or_else(|| self.legacy_selected.clone().filter(is_system_path_candidate))
    }

    pub fn managed_selected_candidate(&self) -> Option<AgentCandidate> {
        self.candidates
            .iter()
            .find(|candidate| candidate.source == "npm_managed")
            .cloned()
    }
}

fn is_system_toolchain_candidate(candidate: &AgentCandidate) -> bool {
    !matches!(candidate.source.as_str(), "npm_managed" | "app_bundled")
}

fn is_system_path_candidate(candidate: &AgentCandidate) -> bool {
    is_system_toolchain_candidate(candidate) && candidate.rank < NON_PATH_CANDIDATE_RANK_BASE
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCandidate {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub realpath: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub source: String,
    pub source_label: String,
    pub rank: u32,
    pub is_user_default: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package: Option<String>,
}

pub fn source_catalog() -> anyhow::Result<AgentSourceCatalog> {
    toml::from_str(AGENT_SOURCES_TOML).context("parse agent-sources.toml")
}

pub fn detected_agents_path() -> PathBuf {
    common::config::data_dir().join("agents.detected.json")
}

pub fn read_detected_agents() -> Option<AgentDetectionFile> {
    let path = detected_agents_path();
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

pub fn startkit_candidate_for_mode(agent_id: &str, toolchain_mode: &str) -> Option<AgentCandidate> {
    read_detected_agents()?
        .agents
        .get(agent_id)
        .and_then(|detection| preferred_startkit_candidate(agent_id, detection, toolchain_mode))
}

pub fn preferred_startkit_candidate(
    agent_id: &str,
    detection: &AgentDetection,
    toolchain_mode: &str,
) -> Option<AgentCandidate> {
    if toolchain_mode == "managed" {
        return agent_uses_npm_install(agent_id)
            .then(|| detection.managed_selected_candidate())
            .flatten();
    }
    detection.system_selected_candidate()
}

pub fn agent_uses_npm_install(agent_id: &str) -> bool {
    source_package(agent_id, "npm_global").is_some()
}

pub fn source_command_template(agent_id: &str, source: &str, action: &str) -> Option<String> {
    let catalog = source_catalog().ok()?;
    let spec = catalog.agents.get(agent_id)?;
    let source = spec.sources.get(source)?;
    let command = match action {
        "install" => &source.install,
        "upgrade" => &source.upgrade,
        _ => return None,
    };
    command.for_current_platform().map(str::to_string)
}

pub fn source_package(agent_id: &str, source: &str) -> Option<String> {
    let catalog = source_catalog().ok()?;
    let spec = catalog.agents.get(agent_id)?;
    spec.sources
        .get(source)
        .and_then(|source_spec| source_spec.package.clone())
        .or_else(|| {
            spec.sources
                .values()
                .find_map(|source_spec| source_spec.package.clone())
        })
}

pub async fn scan_and_persist() -> anyhow::Result<AgentDetectionFile> {
    let catalog = source_catalog()?;
    let detected = scan_agents(&catalog).await?;
    write_detected_agents(&detected)?;
    Ok(detected)
}

pub async fn scan_agent_and_persist(agent_id: &str) -> anyhow::Result<AgentDetection> {
    let catalog = source_catalog()?;
    let spec = agent_command_spec(&catalog, agent_id)?;
    let detection = scan_agent(agent_id, &spec).await;
    let mut detected = read_detected_agents().unwrap_or_else(|| AgentDetectionFile {
        schema_version: DETECTION_SCHEMA_VERSION,
        platform: current_platform().to_string(),
        scanned_at_unix_ms: now_unix_ms(),
        agents: BTreeMap::new(),
    });
    detected.schema_version = DETECTION_SCHEMA_VERSION;
    detected.platform = current_platform().to_string();
    detected.scanned_at_unix_ms = now_unix_ms();
    detected
        .agents
        .insert(agent_id.to_string(), detection.clone());
    write_detected_agents(&detected)?;
    Ok(detection)
}

pub async fn scan_agents(catalog: &AgentSourceCatalog) -> anyhow::Result<AgentDetectionFile> {
    let mut tasks = JoinSet::new();
    for agent in common::resources::AGENTS.iter() {
        if agent.direct_only || !agent.supports_current_platform() {
            continue;
        }
        let spec = agent_command_spec(catalog, &agent.id)?;
        let agent_id = agent.id.clone();
        tasks.spawn(async move {
            let detection = scan_agent(&agent_id, &spec).await;
            (agent_id, detection)
        });
    }

    let mut agents = BTreeMap::new();
    while let Some(result) = tasks.join_next().await {
        let (agent_id, detection) = result?;
        agents.insert(agent_id, detection);
    }

    Ok(AgentDetectionFile {
        schema_version: DETECTION_SCHEMA_VERSION,
        platform: current_platform().to_string(),
        scanned_at_unix_ms: now_unix_ms(),
        agents,
    })
}

fn agent_command_spec(
    catalog: &AgentSourceCatalog,
    agent_id: &str,
) -> anyhow::Result<AgentCommandSpec> {
    if let Some(spec) = catalog.agents.get(agent_id) {
        return Ok(spec.clone());
    }
    let agent = common::resources::agent_by_id(agent_id)
        .ok_or_else(|| anyhow::anyhow!("agent '{}' not found", agent_id))?;
    Ok(AgentCommandSpec {
        program: program_from_command(agent.pty_command_for_current_platform())
            .unwrap_or_else(|| agent.id.clone()),
        version_arg: "--version".to_string(),
        sources: BTreeMap::new(),
    })
}

async fn scan_agent(agent_id: &str, spec: &AgentCommandSpec) -> AgentDetection {
    let mut paths = Vec::new();
    let mut seen = BTreeSet::new();

    for path in user_shell_paths(&spec.program).await {
        if seen.insert(normalize_path_key(&path)) {
            paths.push((path, true));
        }
    }

    for path in package_manager_candidate_paths(&spec.program).await {
        if seen.insert(normalize_path_key(&path)) {
            paths.push((path, false));
        }
    }

    for path in system_candidate_paths(&spec.program) {
        if seen.insert(normalize_path_key(&path)) {
            paths.push((path, false));
        }
    }

    for path in managed_candidate_paths(&spec.program) {
        if seen.insert(normalize_path_key(&path)) {
            paths.push((path, false));
        }
    }

    if agent_id == "codex" {
        for path in codex_app_paths() {
            if seen.insert(normalize_path_key(&path)) {
                paths.push((path, false));
            }
        }
    }

    let mut candidates = Vec::new();
    for (index, (path, from_user_shell)) in paths.into_iter().enumerate() {
        let realpath = canonicalize_to_string(&path);
        let source = classify_source(&path, realpath.as_deref());
        let package = package_for_source(spec, &source);
        let version = command_version(&path, &spec.version_arg).await;
        let rank = candidate_rank(index, from_user_shell, &source);
        let source_label = source_label_for_candidate(spec, &source, &path, realpath.as_deref());
        candidates.push(AgentCandidate {
            path: path.to_string_lossy().to_string(),
            realpath,
            version,
            source_label,
            source,
            rank,
            is_user_default: from_user_shell && index == 0,
            package,
        });
    }

    candidates.sort_by_key(|candidate| candidate.rank);
    let system_selected = candidates
        .iter()
        .find(|candidate| is_system_path_candidate(candidate))
        .cloned();
    let default_candidate = system_selected.clone();
    AgentDetection {
        default_candidate,
        system_selected,
        legacy_selected: None,
        candidates,
    }
}

fn write_detected_agents(detected: &AgentDetectionFile) -> anyhow::Result<()> {
    let path = detected_agents_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create detected agents dir {:?}", parent))?;
    }
    let json = serde_json::to_string_pretty(detected).context("serialize detected agents")?;
    std::fs::write(&path, json).with_context(|| format!("write {:?}", path))?;
    Ok(())
}

async fn user_shell_paths(program: &str) -> Vec<PathBuf> {
    if cfg!(windows) {
        return windows_where_paths(program).await;
    }
    unix_shell_paths(program).await
}

async fn unix_shell_paths(program: &str) -> Vec<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") && Path::new("/bin/zsh").exists() {
            "/bin/zsh".to_string()
        } else {
            "/bin/sh".to_string()
        }
    });
    let escaped_program = shell_escape::unix::escape(std::borrow::Cow::Borrowed(program));
    let script = format!(
        r#"name={};
old_ifs=$IFS
IFS=:
for dir in $PATH; do
  [ -n "$dir" ] || dir=.
  candidate="$dir/$name"
  if [ -x "$candidate" ] && [ ! -d "$candidate" ]; then
    printf '%s\n' "$candidate"
  fi
done
IFS=$old_ifs"#,
        escaped_program
    );
    let mut command = Command::new(shell);
    command.args(["-lic", &script]);
    output_lines(command, Duration::from_secs(6)).await
}

async fn windows_where_paths(program: &str) -> Vec<PathBuf> {
    let mut command = Command::new("where.exe");
    command.arg(program);
    output_lines(command, Duration::from_secs(6)).await
}

async fn package_manager_candidate_paths(program: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    paths.extend(npm_candidate_paths(program).await);
    paths.extend(global_bin_command_candidate_paths("bun", &["pm", "bin", "-g"], program).await);
    paths.extend(global_bin_command_candidate_paths("pnpm", &["bin", "-g"], program).await);
    paths.extend(global_bin_command_candidate_paths("yarn", &["global", "bin"], program).await);
    paths.extend(homebrew_candidate_paths(program).await);
    paths.extend(windows_package_manager_candidate_paths(program));
    dedupe_paths(paths)
}

async fn npm_candidate_paths(program: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for prefix in command_stdout_lines("npm", &["prefix", "-g"], Duration::from_secs(4)).await {
        let prefix = PathBuf::from(prefix);
        let bin_dir = if cfg!(windows) {
            prefix
        } else {
            prefix.join("bin")
        };
        paths.extend(program_candidates_in_dir(bin_dir, program));
    }
    for root in command_stdout_lines("npm", &["root", "-g"], Duration::from_secs(4)).await {
        let root = PathBuf::from(root);
        if let Some(bin_dir) = root.parent().and_then(Path::parent).map(|prefix| {
            if cfg!(windows) {
                prefix.to_path_buf()
            } else {
                prefix.join("bin")
            }
        }) {
            paths.extend(program_candidates_in_dir(bin_dir, program));
        }
    }
    paths
}

async fn homebrew_candidate_paths(program: &str) -> Vec<PathBuf> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let mut paths = Vec::new();
    for prefix in command_stdout_lines("brew", &["--prefix"], Duration::from_secs(4)).await {
        let prefix = PathBuf::from(prefix);
        paths.extend(program_candidates_in_dir(prefix.join("bin"), program));
        paths.extend(program_candidates_in_dir(prefix.join("sbin"), program));
    }
    paths
}

async fn global_bin_command_candidate_paths(
    command: &str,
    args: &[&str],
    program: &str,
) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for dir in command_stdout_lines(command, args, Duration::from_secs(4)).await {
        paths.extend(program_candidates_in_dir(PathBuf::from(dir), program));
    }
    paths
}

async fn command_stdout_lines(command: &str, args: &[&str], max_duration: Duration) -> Vec<String> {
    let mut command = Command::new(command);
    command.args(args);
    output_lines(command, max_duration)
        .await
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

fn system_candidate_paths(program: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if cfg!(windows) {
        paths.extend(windows_known_candidate_paths(program));
        return paths;
    }

    let home = common::config::home_dir();
    for dir in [
        home.join(".bun").join("bin"),
        home.join(".local").join("bin"),
        home.join(".npm-global").join("bin"),
        home.join(".yarn").join("bin"),
        home.join("Library").join("pnpm"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/bin"),
    ] {
        paths.extend(program_candidates_in_dir(dir, program));
    }
    paths
}

fn managed_candidate_paths(program: &str) -> Vec<PathBuf> {
    program_candidates_in_dir(common::process::env::managed_npm_bin_dir(), program)
}

fn windows_package_manager_candidate_paths(program: &str) -> Vec<PathBuf> {
    if !cfg!(windows) {
        return Vec::new();
    }
    let mut paths = Vec::new();
    if let Ok(chocolatey) = std::env::var("ChocolateyInstall") {
        paths.extend(program_candidates_in_dir(
            Path::new(&chocolatey).join("bin"),
            program,
        ));
    }
    if let Ok(scoop) = std::env::var("SCOOP") {
        paths.extend(program_candidates_in_dir(
            Path::new(&scoop).join("shims"),
            program,
        ));
    }
    if let Ok(scoop_global) = std::env::var("SCOOP_GLOBAL") {
        paths.extend(program_candidates_in_dir(
            Path::new(&scoop_global).join("shims"),
            program,
        ));
    }
    paths
}

fn windows_known_candidate_paths(program: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let home = common::config::home_dir();
    if let Ok(appdata) = std::env::var("APPDATA") {
        paths.extend(program_candidates_in_dir(
            Path::new(&appdata).join("npm"),
            program,
        ));
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        let localappdata = Path::new(&localappdata);
        paths.extend(program_candidates_in_dir(
            localappdata
                .join("Microsoft")
                .join("WinGet")
                .join("Packages"),
            program,
        ));
        paths.extend(program_candidates_in_dir(
            localappdata.join("Programs").join("Git").join("cmd"),
            program,
        ));
    }
    paths.extend(program_candidates_in_dir(
        home.join("scoop").join("shims"),
        program,
    ));
    paths.extend(program_candidates_in_dir(
        home.join(".bun").join("bin"),
        program,
    ));
    paths.extend(program_candidates_in_dir(
        home.join(".local").join("bin"),
        program,
    ));
    paths
}

fn program_candidates_in_dir(dir: PathBuf, program: &str) -> Vec<PathBuf> {
    if cfg!(windows) {
        let candidates = if Path::new(program).extension().is_some() {
            vec![dir.join(program)]
        } else {
            vec![
                dir.join(program),
                dir.join(format!("{program}.exe")),
                dir.join(format!("{program}.cmd")),
                dir.join(format!("{program}.bat")),
                dir.join(format!("{program}.ps1")),
            ]
        };
        return candidates
            .into_iter()
            .filter(|path| path.exists())
            .collect();
    }
    let path = dir.join(program);
    if path.exists() {
        vec![path]
    } else {
        Vec::new()
    }
}

async fn output_lines(mut command: Command, max_duration: Duration) -> Vec<PathBuf> {
    let Ok(output) = tokio::time::timeout(max_duration, command.output()).await else {
        return Vec::new();
    };
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() && output.stdout.is_empty() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect()
}

async fn command_version(path: &Path, version_arg: &str) -> Option<String> {
    let mut command = command_for_version_check(path, version_arg);
    let output = tokio::time::timeout(VERSION_CHECK_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text = stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())?
        .to_string();
    Some(text)
}

fn command_for_version_check(path: &Path, version_arg: &str) -> Command {
    if cfg!(windows) {
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());
        if matches!(ext.as_deref(), Some("cmd" | "bat")) {
            let mut command = Command::new("cmd.exe");
            command.arg("/C").arg(path).arg(version_arg);
            return command;
        }
        if ext.as_deref() == Some("ps1") {
            let mut command = Command::new("powershell.exe");
            command
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(path)
                .arg(version_arg);
            return command;
        }
    }
    let mut command = Command::new(path);
    command.arg(version_arg);
    command
}

fn codex_app_paths() -> Vec<PathBuf> {
    codex_app_binary_paths()
        .into_iter()
        .filter(|path| path.exists())
        .collect()
}

fn codex_app_binary_paths() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        [
            PathBuf::from("/Applications/Codex.app"),
            common::config::home_dir()
                .join("Applications")
                .join("Codex.app"),
        ]
        .into_iter()
        .map(|app| app.join("Contents").join("Resources").join("codex"))
        .collect()
    } else {
        Vec::new()
    }
}

fn classify_source(path: &Path, realpath: Option<&str>) -> String {
    let path_str = path.to_string_lossy();
    let real = realpath.unwrap_or(path_str.as_ref());
    let data_dir = common::config::data_dir();
    let managed_prefix = data_dir.to_string_lossy();

    if path_str.starts_with(managed_prefix.as_ref()) || real.starts_with(managed_prefix.as_ref()) {
        return "npm_managed".to_string();
    }
    if path_str.contains(".bun/bin") || real.contains(".bun/install/global") {
        return "bun_global".to_string();
    }
    if real.contains("/Cellar/") || real.contains("\\Cellar\\") {
        return "homebrew_formula".to_string();
    }
    if real.contains("/Caskroom/") || real.contains("\\Caskroom\\") {
        return "homebrew_cask".to_string();
    }
    if is_app_bundle_path(&path_str) || is_app_bundle_path(real) {
        return "app_bundled".to_string();
    }
    if real.contains("/lib/node_modules/") || real.contains("\\node_modules\\") {
        return "npm_global".to_string();
    }
    if path_str.contains(".local/bin") || real.contains(".local/share") {
        return "native".to_string();
    }
    "path".to_string()
}

fn is_app_bundle_path(path: &str) -> bool {
    if cfg!(target_os = "macos") {
        return path.contains(".app/Contents/");
    }
    path.contains(".app\\Contents\\")
}

fn package_for_source(spec: &AgentCommandSpec, source: &str) -> Option<String> {
    spec.sources
        .get(source)
        .and_then(|source| source.package.clone())
        .or_else(|| {
            if source == "npm_managed" || source == "npm_global" || source == "bun_global" {
                spec.sources
                    .values()
                    .find_map(|source| source.package.clone())
            } else {
                None
            }
        })
}

fn source_label(spec: &AgentCommandSpec, source: &str) -> String {
    spec.sources
        .get(source)
        .and_then(|source| source.label.clone())
        .unwrap_or_else(|| {
            match source {
                "npm_managed" => "VibeAround npm",
                "npm_global" => "npm global",
                "bun_global" => "Bun global",
                "homebrew_formula" => "Homebrew formula",
                "homebrew_cask" => "Homebrew cask",
                "native" => "Native installer",
                "app_bundled" => "Bundled app",
                _ => "PATH",
            }
            .to_string()
        })
}

fn source_label_for_candidate(
    spec: &AgentCommandSpec,
    source: &str,
    path: &Path,
    realpath: Option<&str>,
) -> String {
    if source == "npm_global" && is_homebrew_prefix_path(path, realpath) {
        return "npm global (Homebrew prefix)".to_string();
    }
    source_label(spec, source)
}

fn is_homebrew_prefix_path(path: &Path, realpath: Option<&str>) -> bool {
    let path = path.to_string_lossy();
    let real = realpath.unwrap_or(path.as_ref());
    path.starts_with("/opt/homebrew/")
        || real.starts_with("/opt/homebrew/")
        || path.starts_with("/usr/local/")
        || real.starts_with("/usr/local/")
}

fn candidate_rank(index: usize, from_user_shell: bool, source: &str) -> u32 {
    if from_user_shell {
        return index as u32;
    }
    match source {
        "npm_managed" => 10_000 + index as u32,
        "app_bundled" => 20_000 + index as u32,
        _ => NON_PATH_CANDIDATE_RANK_BASE + index as u32,
    }
}

fn canonicalize_to_string(path: &Path) -> Option<String> {
    std::fs::canonicalize(path)
        .ok()
        .map(|path| path.to_string_lossy().to_string())
}

fn normalize_path_key(path: &Path) -> String {
    canonicalize_to_string(path).unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    let mut deduped = Vec::new();
    for path in paths {
        if seen.insert(normalize_path_key(&path)) {
            deduped.push(path);
        }
    }
    deduped
}

fn program_from_command(command: &str) -> Option<String> {
    command.split_whitespace().next().map(str::to_string)
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
    fn source_catalog_parses_agent_commands() {
        let catalog = source_catalog().expect("catalog parses");
        let codex = catalog.agents.get("codex").expect("codex source");
        assert_eq!(codex.program, "codex");
        assert!(!codex.sources.contains_key("npm_managed"));
        assert_eq!(
            codex.sources["npm_global"].package.as_deref(),
            Some("@openai/codex")
        );
    }

    #[test]
    fn classifies_homebrew_npm_global_separately_from_formula() {
        assert_eq!(
            classify_source(
                Path::new("/opt/homebrew/bin/codex"),
                Some("/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js"),
            ),
            "npm_global"
        );
        assert_eq!(
            classify_source(
                Path::new("/opt/homebrew/bin/opencode"),
                Some("/opt/homebrew/Cellar/opencode/1.17.0/bin/opencode"),
            ),
            "homebrew_formula"
        );
    }

    #[test]
    fn labels_homebrew_prefix_npm_globals_without_treating_them_as_brew_packages() {
        let catalog = source_catalog().expect("catalog parses");
        let spec = catalog.agents.get("codex").expect("codex source");
        assert_eq!(
            source_label_for_candidate(
                spec,
                "npm_global",
                Path::new("/opt/homebrew/bin/codex"),
                Some("/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js"),
            ),
            "npm global (Homebrew prefix)"
        );
    }

    #[test]
    fn native_sources_can_reuse_agent_package_for_latest_checks() {
        assert_eq!(
            source_package("claude", "native").as_deref(),
            Some("@anthropic-ai/claude-code")
        );
        assert_eq!(
            source_package("codex", "app_bundled").as_deref(),
            Some("@openai/codex")
        );
    }

    #[test]
    fn npm_installability_comes_from_source_catalog() {
        assert!(agent_uses_npm_install("codex"));
        assert!(agent_uses_npm_install("claude"));
        assert!(agent_uses_npm_install("gemini"));
        assert!(agent_uses_npm_install("qwen-code"));
        assert!(!agent_uses_npm_install("cursor"));
    }

    #[test]
    fn codex_app_binary_paths_include_user_applications() {
        let paths = codex_app_binary_paths();
        if cfg!(target_os = "macos") {
            assert!(paths.contains(&PathBuf::from(
                "/Applications/Codex.app/Contents/Resources/codex"
            )));
            assert!(paths.contains(
                &common::config::home_dir()
                    .join("Applications")
                    .join("Codex.app")
                    .join("Contents")
                    .join("Resources")
                    .join("codex")
            ));
        } else {
            assert!(paths.is_empty());
        }
    }

    #[test]
    fn managed_candidates_rank_after_user_shell_hits() {
        assert!(candidate_rank(0, true, "npm_global") < candidate_rank(0, false, "npm_managed"));
    }

    #[test]
    fn dedupe_paths_uses_realpath_when_available() {
        let first = common::config::home_dir()
            .join(".bun")
            .join("bin")
            .join("codex");
        let second = first.clone();
        let paths = dedupe_paths(vec![first, second]);
        assert_eq!(paths.len(), 1);
    }

    #[test]
    fn system_selection_prefers_system_candidate() {
        let system = test_candidate("/usr/local/bin/codex", "npm_global", 0);
        let managed = test_candidate("/tmp/.vibearound/npm/bin/codex", "npm_managed", 10_000);
        let detection = AgentDetection {
            default_candidate: Some(managed.clone()),
            system_selected: Some(system.clone()),
            legacy_selected: None,
            candidates: vec![system.clone(), managed.clone()],
        };

        assert_eq!(
            detection
                .system_selected_candidate()
                .as_ref()
                .map(|candidate| candidate.path.as_str()),
            Some(system.path.as_str())
        );

        let json = serde_json::to_string(&detection).expect("serialize detection");
        assert!(json.contains("\"default\""));
        assert!(json.contains("\"systemSelected\""));
        assert!(!json.contains("\"selected\""));
    }

    #[test]
    fn managed_startkit_selection_accepts_managed_candidate_for_npm_agents() {
        let managed = test_candidate("/tmp/.vibearound/npm/bin/codex", "npm_managed", 10_000);
        let detection = AgentDetection {
            default_candidate: Some(managed.clone()),
            system_selected: Some(managed.clone()),
            legacy_selected: None,
            candidates: vec![managed.clone()],
        };

        assert_eq!(
            preferred_startkit_candidate("codex", &detection, "managed")
                .as_ref()
                .map(|candidate| candidate.path.as_str()),
            Some(managed.path.as_str())
        );
        assert!(preferred_startkit_candidate("codex", &detection, "system").is_none());
    }

    #[test]
    fn system_selection_uses_selected_path_and_ignores_unselected_candidates() {
        let system = test_candidate("/usr/local/bin/codex", "npm_global", 0);
        let managed = test_candidate("/tmp/.vibearound/npm/bin/codex", "npm_managed", 10_000);
        let detection = AgentDetection {
            default_candidate: Some(managed.clone()),
            system_selected: Some(system.clone()),
            legacy_selected: None,
            candidates: vec![managed.clone(), system.clone()],
        };

        assert_eq!(
            detection
                .system_selected_candidate()
                .as_ref()
                .map(|candidate| candidate.path.as_str()),
            Some(system.path.as_str())
        );

        let managed_only = AgentDetection {
            default_candidate: Some(managed.clone()),
            system_selected: Some(managed.clone()),
            legacy_selected: None,
            candidates: vec![managed.clone(), system.clone()],
        };
        assert!(managed_only.system_selected_candidate().is_none());

        let legacy_selected = AgentDetection {
            default_candidate: None,
            system_selected: None,
            legacy_selected: Some(system.clone()),
            candidates: vec![system, managed],
        };
        assert!(legacy_selected.system_selected_candidate().is_some());
    }

    #[test]
    fn system_selection_only_accepts_user_path_candidates() {
        let npm_global_not_on_path = test_candidate("/opt/homebrew/bin/codex", "npm_global", 5_000);
        let app_bundled = test_candidate(
            "/Applications/Codex.app/Contents/Resources/codex",
            "app_bundled",
            20_000,
        );
        let detection = AgentDetection {
            default_candidate: Some(app_bundled.clone()),
            system_selected: Some(app_bundled.clone()),
            legacy_selected: None,
            candidates: vec![app_bundled, npm_global_not_on_path],
        };

        assert!(detection.system_selected_candidate().is_none());
        assert!(preferred_startkit_candidate("codex", &detection, "system").is_none());
    }

    #[test]
    fn app_bundle_paths_are_not_system_toolchain_candidates() {
        let candidate = test_candidate(
            "/Applications/Claude.app/Contents/Resources/claude",
            "app_bundled",
            0,
        );
        assert!(!is_system_toolchain_candidate(&candidate));
        assert_eq!(
            classify_source(
                Path::new("/usr/local/bin/claude"),
                Some("/Applications/Claude.app/Contents/Resources/claude"),
            ),
            "app_bundled"
        );
    }

    fn test_candidate(path: &str, source: &str, rank: u32) -> AgentCandidate {
        AgentCandidate {
            path: path.to_string(),
            realpath: None,
            version: None,
            source: source.to_string(),
            source_label: source.to_string(),
            rank,
            is_user_default: rank == 0,
            package: None,
        }
    }
}
