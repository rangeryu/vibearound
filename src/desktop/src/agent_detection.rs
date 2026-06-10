use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

const AGENT_SOURCES_TOML: &str = include_str!("../../resources/agent-sources.toml");
const DETECTION_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize)]
pub struct AgentSourceCatalog {
    #[serde(default)]
    pub defaults: AgentSourceDefaults,
    #[serde(default)]
    pub agents: BTreeMap<String, AgentCommandSpec>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct AgentSourceDefaults {
    #[serde(default = "default_install_source")]
    pub install_source: String,
}

fn default_install_source() -> String {
    "npm_managed".to_string()
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
    pub selected: Option<AgentCandidate>,
    pub candidates: Vec<AgentCandidate>,
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

pub fn selected_candidate_for(agent_id: &str) -> Option<AgentCandidate> {
    read_detected_agents()?
        .agents
        .get(agent_id)
        .and_then(|detection| detection.selected.clone())
}

pub async fn scan_and_persist() -> anyhow::Result<AgentDetectionFile> {
    let catalog = source_catalog()?;
    let detected = scan_agents(&catalog).await?;
    write_detected_agents(&detected)?;
    Ok(detected)
}

pub async fn scan_agents(catalog: &AgentSourceCatalog) -> anyhow::Result<AgentDetectionFile> {
    let mut agents = BTreeMap::new();
    for agent in common::resources::AGENTS.iter() {
        let spec = catalog
            .agents
            .get(&agent.id)
            .cloned()
            .unwrap_or_else(|| AgentCommandSpec {
                program: program_from_command(&agent.pty.command)
                    .unwrap_or_else(|| agent.id.clone()),
                version_arg: "--version".to_string(),
                sources: BTreeMap::new(),
            });
        let detection = scan_agent(&agent.id, &spec).await;
        agents.insert(agent.id.clone(), detection);
    }

    Ok(AgentDetectionFile {
        schema_version: DETECTION_SCHEMA_VERSION,
        platform: current_platform().to_string(),
        scanned_at_unix_ms: now_unix_ms(),
        agents,
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

    for path in managed_paths(&spec.program) {
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
        candidates.push(AgentCandidate {
            path: path.to_string_lossy().to_string(),
            realpath,
            version,
            source_label: source_label(spec, &source),
            source,
            rank,
            is_user_default: from_user_shell && index == 0,
            package,
        });
    }

    candidates.sort_by_key(|candidate| candidate.rank);
    let selected = candidates.first().cloned();
    AgentDetection {
        selected,
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
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
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
    let mut command = Command::new(path);
    command.arg(version_arg);
    let output = tokio::time::timeout(Duration::from_secs(6), command.output())
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

fn managed_paths(program: &str) -> Vec<PathBuf> {
    let data_dir = common::config::data_dir();
    if cfg!(windows) {
        vec![
            data_dir.join("npm-global").join(format!("{program}.cmd")),
            data_dir
                .join("npm-global")
                .join("bin")
                .join(format!("{program}.cmd")),
            data_dir.join("bin").join(format!("{program}.exe")),
            data_dir.join("bin").join(program),
        ]
        .into_iter()
        .filter(|path| path.exists())
        .collect()
    } else {
        vec![
            data_dir.join("npm-global").join("bin").join(program),
            data_dir.join("npm-global").join(program),
            data_dir.join("bin").join(program),
        ]
        .into_iter()
        .filter(|path| path.exists())
        .collect()
    }
}

fn codex_app_paths() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        ["/Applications/Codex.app/Contents/Resources/codex"]
            .into_iter()
            .map(PathBuf::from)
            .filter(|path| path.exists())
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
    if path_str.contains("Codex.app") || real.contains("Codex.app") {
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
                "npm_managed" => "VibeAround managed npm",
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

fn candidate_rank(index: usize, from_user_shell: bool, source: &str) -> u32 {
    if from_user_shell {
        return index as u32;
    }
    match source {
        "npm_managed" => 10_000 + index as u32,
        "app_bundled" => 20_000 + index as u32,
        _ => 5_000 + index as u32,
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
