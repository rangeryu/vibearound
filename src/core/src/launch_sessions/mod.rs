//! Local coding-agent session discovery for the desktop Launch surface.
//!
//! This is intentionally read-only. Each CLI owns its own session store; we
//! only surface enough metadata for users to choose what to resume.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

mod archive;
mod claude;
mod codex;
mod cursor;
mod gemini;
mod opencode;
mod qwen;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSession {
    pub agent_id: String,
    pub session_id: String,
    pub title: String,
    pub workspace: String,
    pub updated_at: u64,
    pub source: String,
    pub archived: bool,
}

pub fn list_for_agent_workspace(
    agent_id: &str,
    workspace: &Path,
    limit: usize,
) -> Vec<LaunchSession> {
    list_for_agent_workspace_with_archived(agent_id, workspace, limit, false)
}

pub fn list_for_agent_workspace_with_archived(
    agent_id: &str,
    workspace: &Path,
    limit: usize,
    include_archived: bool,
) -> Vec<LaunchSession> {
    let mut sessions = match agent_id {
        "claude" => claude::sessions(workspace),
        "codex" => codex::sessions(workspace, include_archived),
        "cursor" => cursor::sessions(workspace),
        "gemini" => gemini::sessions(workspace),
        "opencode" => opencode::sessions(workspace),
        "qwen-code" => qwen::sessions(workspace),
        _ => Vec::new(),
    };
    let archived_session_ids = archive::archived_session_keys(agent_id, workspace);
    if !archived_session_ids.is_empty() {
        for session in &mut sessions {
            if archived_session_ids.contains(&session.session_id) {
                session.archived = true;
            }
        }
        if !include_archived {
            sessions.retain(|session| !session.archived);
        }
    }
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions.truncate(limit);
    sessions
}

pub fn archive_session(agent_id: &str, workspace: &Path, session_id: &str) -> Result<(), String> {
    archive::archive_session(agent_id, workspace, session_id)
}

pub fn unarchive_session(agent_id: &str, workspace: &Path, session_id: &str) -> Result<(), String> {
    archive::unarchive_session(agent_id, workspace, session_id)
}

pub fn latest_for_agent_workspace(agent_id: &str, workspace: &Path) -> Option<LaunchSession> {
    list_for_agent_workspace(agent_id, workspace, 1)
        .into_iter()
        .next()
}

pub(super) fn dash_encoded_cwd(cwd: &Path) -> String {
    cwd.to_string_lossy()
        .chars()
        .map(|ch| if ch.is_alphanumeric() { ch } else { '-' })
        .collect()
}

pub(super) fn message_text(message: &Value) -> Option<&str> {
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        return Some(text);
    }
    for key in ["content", "parts"] {
        if let Some(items) = message.get(key).and_then(Value::as_array) {
            for item in items {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    return Some(text);
                }
                if let Some(text) = item.get("data").and_then(Value::as_str) {
                    return Some(text);
                }
            }
        }
    }
    None
}

pub(super) fn walk_files(dir: &Path, visit: &mut impl FnMut(&Path)) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_files(&path, visit);
        } else {
            visit(&path);
        }
    }
}

pub(super) fn modified_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(system_time_secs)
        .unwrap_or(0)
}

fn system_time_secs(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

pub(super) fn timestamp_secs(value: u64) -> u64 {
    if value > 1_000_000_000_000 {
        value / 1_000
    } else {
        value
    }
}

pub(super) fn clean_title(value: &str) -> Option<String> {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let compact = compact.trim();
    if compact.is_empty() {
        return None;
    }
    let mut out = String::new();
    for ch in compact.chars().take(72) {
        out.push(ch);
    }
    Some(out)
}

pub(super) fn fallback_title(workspace: &Path, session_id: &str) -> String {
    let workspace = workspace
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Session");
    format!("{workspace} {}", short_id(session_id))
}

pub fn short_id(session_id: &str) -> String {
    session_id.chars().take(8).collect()
}
