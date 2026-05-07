//! Workspace choices for profile/direct launches.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use common::{agent_state, config, resources};
use serde::Serialize;

use super::terminal;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOption {
    pub path: String,
    pub label: String,
    pub detail: String,
    pub kind: String,
    pub is_default: bool,
}

pub(super) fn launcher_workspace_options(agent_id: Option<&str>) -> Vec<WorkspaceOption> {
    let builtin = config::builtin_workspaces_dir();
    let home = terminal::launch_home_dir().unwrap_or_else(|_| config::data_dir());
    let agent_prefs = agent_state::read_prefs();
    let selected = agent_id
        .map(canonical_agent_id)
        .and_then(|agent_id| resolve_agent_workspace_preference(&agent_id, &agent_prefs).ok())
        .or_else(|| terminal::resolve_workspace_preference().ok());
    if let Some(path) = selected.as_ref() {
        let _ = register_launcher_workspace(path);
    }
    let cfg = config::ensure_loaded();

    let mut out = Vec::new();
    push_workspace_option(&mut out, &home, "Home", "home", false);
    for workspace in cfg.all_workspaces() {
        let is_default = paths_equal(&workspace, &builtin);
        let kind = if is_default { "built-in" } else { "workspace" };
        let label = if is_default {
            "Default workspace".to_string()
        } else {
            path_label(&workspace)
        };
        push_workspace_option(&mut out, &workspace, &label, kind, is_default);
    }
    if let Some(path) = selected {
        if !out
            .iter()
            .any(|option| paths_equal(Path::new(&option.path), &path))
        {
            let label = path_label(&path);
            push_workspace_option(&mut out, &path, &label, "selected", false);
        }
    }
    out
}

pub(super) fn set_workspace(workspace_path: &str, agent_id: Option<String>) -> Result<(), String> {
    let path =
        terminal::canonical_workspace_path(Path::new(workspace_path)).map_err(|e| e.to_string())?;
    register_launcher_workspace(&path)?;
    let cfg = config::ensure_loaded();
    let agent_prefs = agent_state::read_prefs();
    let agent_id = agent_id
        .map(|id| canonical_agent_id(&id))
        .unwrap_or_else(|| agent_state::resolve_selected_agent(&agent_prefs, &cfg));
    agent_state::write_agent_workspace(&agent_id, path).map_err(|e| e.to_string())
}

pub(super) fn remove_workspace(workspace_path: String) -> Result<(), String> {
    let path = PathBuf::from(workspace_path);
    let cfg = config::ensure_loaded();
    let builtin = config::builtin_workspaces_dir();
    if paths_equal(&path, &builtin) {
        return Err("Cannot remove the built-in workspace".to_string());
    }
    if !cfg
        .workspaces
        .iter()
        .any(|workspace| paths_equal(workspace, &path))
    {
        return Err(format!("workspace is not registered: {}", path.display()));
    }

    config::update_settings_json(|root| {
        if let Some(arr) = root
            .get_mut("workspaces")
            .and_then(|value| value.as_array_mut())
        {
            arr.retain(|value| {
                value
                    .as_str()
                    .map(|candidate| !paths_equal(Path::new(candidate), &path))
                    .unwrap_or(true)
            });
        }
    })
    .map_err(|e| e.to_string())?;

    if terminal::read_workspace_preference()
        .as_ref()
        .map(|selected| paths_equal(selected, &path))
        .unwrap_or(false)
    {
        let fallback = config::ensure_loaded().resolve_workspace("codex");
        terminal::write_workspace_preference(fallback).map_err(|e| e.to_string())?;
    }
    agent_state::remove_workspace_references(&path).map_err(|e| e.to_string())
}

pub(super) fn reorder_workspaces(workspace_paths: Vec<String>) -> Result<(), String> {
    let cfg = config::ensure_loaded();
    let builtin = config::builtin_workspaces_dir();
    let mut seen = HashSet::new();
    let mut ordered = Vec::new();

    for path in workspace_paths {
        let canonical = PathBuf::from(path);
        if paths_equal(&canonical, &builtin) {
            continue;
        }
        if cfg
            .workspaces
            .iter()
            .any(|workspace| paths_equal(workspace, &canonical))
            && seen.insert(canonical.clone())
        {
            ordered.push(canonical);
        }
    }

    for workspace in &cfg.workspaces {
        if paths_equal(workspace, &builtin) {
            continue;
        }
        if seen.insert(workspace.clone()) {
            ordered.push(workspace.clone());
        }
    }

    config::update_settings_json(|root| {
        if let Some(obj) = root.as_object_mut() {
            obj.insert(
                "workspaces".into(),
                serde_json::Value::Array(
                    ordered
                        .iter()
                        .map(|path| serde_json::Value::String(path.to_string_lossy().to_string()))
                        .collect(),
                ),
            );
        }
    })
    .map_err(|e| e.to_string())
}

pub(super) fn canonical_agent_id(agent_id: &str) -> String {
    resources::agent_by_alias(agent_id)
        .map(|def| def.id.clone())
        .unwrap_or_else(|| agent_id.to_string())
}

pub(super) fn resolve_agent_workspace_preference(
    agent_id: &str,
    agent_prefs: &agent_state::AgentsPrefsFile,
) -> anyhow::Result<PathBuf> {
    if let Some(workspace) = agent_prefs
        .agents
        .get(agent_id)
        .and_then(|preference| preference.workspace.as_ref())
    {
        return terminal::canonical_workspace_path(workspace);
    }
    terminal::resolve_workspace_preference()
}

pub(super) fn resolve_launch_workspace(agent_id: &str) -> anyhow::Result<PathBuf> {
    let agent_prefs = agent_state::read_prefs();
    resolve_agent_workspace_preference(agent_id, &agent_prefs)
}

fn register_launcher_workspace(path: &Path) -> Result<(), String> {
    let builtin = config::builtin_workspaces_dir();
    if paths_equal(path, &builtin) {
        return Ok(());
    }
    if terminal::launch_home_dir()
        .as_ref()
        .map(|home| paths_equal(path, home))
        .unwrap_or(false)
    {
        return Ok(());
    }

    let cfg = config::ensure_loaded();
    if cfg
        .workspaces
        .iter()
        .any(|workspace| paths_equal(workspace, path))
    {
        return Ok(());
    }

    config::update_settings_json(|root| {
        if !root.is_object() {
            *root = serde_json::json!({});
        }
        if let Some(obj) = root.as_object_mut() {
            let workspaces = obj
                .entry("workspaces")
                .or_insert_with(|| serde_json::json!([]));
            if !workspaces.is_array() {
                *workspaces = serde_json::json!([]);
            }
            if let Some(arr) = workspaces.as_array_mut() {
                let already_registered = arr
                    .iter()
                    .filter_map(|value| value.as_str())
                    .any(|candidate| paths_equal(Path::new(candidate), path));
                if !already_registered {
                    arr.push(serde_json::Value::String(
                        path.to_string_lossy().to_string(),
                    ));
                }
            }
        }
    })
    .map_err(|e| e.to_string())
}

fn push_workspace_option(
    out: &mut Vec<WorkspaceOption>,
    path: &Path,
    label: &str,
    kind: &str,
    is_default: bool,
) {
    if out
        .iter()
        .any(|option| paths_equal(Path::new(&option.path), path))
    {
        return;
    }
    out.push(WorkspaceOption {
        path: path.to_string_lossy().to_string(),
        label: label.to_string(),
        detail: path.to_string_lossy().to_string(),
        kind: kind.to_string(),
        is_default,
    });
}

fn path_label(path: &Path) -> String {
    if let Some(name) = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
    {
        name.to_string()
    } else {
        path.to_string_lossy().to_string()
    }
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    left == right
        || std::fs::canonicalize(left)
            .ok()
            .zip(std::fs::canonicalize(right).ok())
            .map(|(left, right)| left == right)
            .unwrap_or(false)
}
