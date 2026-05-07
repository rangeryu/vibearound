//! Local coding-agent session discovery for the desktop Launch surface.
//!
//! This is intentionally read-only. Each CLI owns its own session store; we
//! only surface enough metadata for users to choose what to resume.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use crate::config;

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
        "claude" => claude_sessions(workspace),
        "codex" => codex_sessions(workspace, include_archived),
        "cursor" => cursor_sessions(workspace),
        "gemini" => gemini_sessions(workspace),
        "opencode" => opencode_sessions(workspace),
        "qwen-code" => qwen_sessions(workspace),
        _ => Vec::new(),
    };
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions.truncate(limit);
    sessions
}

pub fn latest_for_agent_workspace(agent_id: &str, workspace: &Path) -> Option<LaunchSession> {
    list_for_agent_workspace(agent_id, workspace, 1)
        .into_iter()
        .next()
}

fn claude_sessions(workspace: &Path) -> Vec<LaunchSession> {
    let session_dir = config::home_dir()
        .join(".claude")
        .join("projects")
        .join(claude_encoded_cwd(workspace));
    let Ok(entries) = fs::read_dir(session_dir) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                return None;
            }
            let session_id = path.file_stem()?.to_str()?.to_string();
            let updated_at = modified_secs(&path);
            let title =
                claude_title(&path).unwrap_or_else(|| fallback_title(workspace, &session_id));
            Some(LaunchSession {
                agent_id: "claude".to_string(),
                session_id,
                title,
                workspace: workspace.to_string_lossy().to_string(),
                updated_at,
                source: "claude".to_string(),
                archived: false,
            })
        })
        .collect()
}

fn claude_encoded_cwd(cwd: &Path) -> String {
    cwd.to_string_lossy()
        .chars()
        .map(|ch| if ch.is_alphanumeric() { ch } else { '-' })
        .collect()
}

fn claude_title(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().map_while(Result::ok).take(80) {
        let json: Value = serde_json::from_str(&line).ok()?;
        if json.get("type").and_then(Value::as_str) != Some("user") {
            continue;
        }
        if let Some(text) = json
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .and_then(clean_title)
        {
            return Some(text);
        }
    }
    None
}

fn codex_sessions(workspace: &Path, include_archived: bool) -> Vec<LaunchSession> {
    let root = config::home_dir().join(".codex").join("sessions");
    let mut out = Vec::new();
    walk_files(&root, &mut |path| {
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            return;
        }
        if let Some(session) = codex_session_from_file(path, workspace, false) {
            out.push(session);
        }
    });
    if include_archived {
        let archived_root = config::home_dir().join(".codex").join("archived_sessions");
        walk_files(&archived_root, &mut |path| {
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                return;
            }
            if let Some(session) = codex_session_from_file(path, workspace, true) {
                out.push(session);
            }
        });
    }
    out
}

fn codex_session_from_file(path: &Path, workspace: &Path, archived: bool) -> Option<LaunchSession> {
    let file = fs::File::open(path).ok()?;
    let workspace_str = workspace.to_string_lossy();
    let mut session_id: Option<String> = None;
    let mut session_cwd: Option<String> = None;
    let mut summary_title: Option<String> = None;
    let mut first_user_title: Option<String> = None;

    for line in BufReader::new(file).lines().map_while(Result::ok).take(600) {
        let Ok(json) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(payload) = json.get("payload") else {
            continue;
        };

        if session_id.is_none() {
            session_id = payload
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }
        if session_cwd.is_none() {
            session_cwd = payload
                .get("cwd")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }
        if summary_title.is_none() {
            summary_title = payload
                .get("summary")
                .and_then(Value::as_str)
                .and_then(clean_title)
                .filter(|title| title != "none");
        }
        if first_user_title.is_none() {
            first_user_title = codex_user_message_title(payload);
        }
    }

    let session_id = session_id?;
    if session_cwd.as_deref() != Some(workspace_str.as_ref()) {
        return None;
    }
    let title = summary_title
        .or(first_user_title)
        .unwrap_or_else(|| fallback_title(workspace, &session_id));

    Some(LaunchSession {
        agent_id: "codex".to_string(),
        session_id,
        title,
        workspace: workspace.to_string_lossy().to_string(),
        updated_at: modified_secs(path),
        source: "codex".to_string(),
        archived,
    })
}

fn codex_user_message_title(payload: &Value) -> Option<String> {
    if payload.get("type").and_then(Value::as_str) == Some("user_message") {
        return payload
            .get("message")
            .and_then(Value::as_str)
            .and_then(codex_clean_user_title);
    }

    if payload.get("role").and_then(Value::as_str) == Some("user") {
        if let Some(text) = payload
            .get("text")
            .and_then(Value::as_str)
            .and_then(codex_clean_user_title)
        {
            return Some(text);
        }
        if let Some(content) = payload.get("content").and_then(Value::as_array) {
            for item in content {
                if let Some(text) = item
                    .get("text")
                    .and_then(Value::as_str)
                    .and_then(codex_clean_user_title)
                {
                    return Some(text);
                }
            }
        }
    }

    None
}

fn codex_clean_user_title(value: &str) -> Option<String> {
    let trimmed = value.trim_start();
    if trimmed.starts_with("<environment_context>")
        || trimmed.starts_with("<system_context>")
        || trimmed.starts_with("<developer_context>")
    {
        return None;
    }
    clean_title(value)
}

fn cursor_sessions(workspace: &Path) -> Vec<LaunchSession> {
    let transcripts_dir = config::home_dir()
        .join(".cursor")
        .join("projects")
        .join(cursor_encoded_cwd(workspace))
        .join("agent-transcripts");
    let mut out = Vec::new();
    walk_files(&transcripts_dir, &mut |path| {
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            return;
        }
        let Some(session_id) = path.file_stem().and_then(|stem| stem.to_str()) else {
            return;
        };
        out.push(LaunchSession {
            agent_id: "cursor".to_string(),
            session_id: session_id.to_string(),
            title: cursor_title(path).unwrap_or_else(|| fallback_title(workspace, session_id)),
            workspace: workspace.to_string_lossy().to_string(),
            updated_at: modified_secs(path),
            source: "cursor".to_string(),
            archived: false,
        });
    });
    out
}

fn cursor_encoded_cwd(cwd: &Path) -> String {
    cwd.to_string_lossy()
        .trim_start_matches('/')
        .chars()
        .map(|ch| if ch.is_alphanumeric() { ch } else { '-' })
        .collect()
}

fn cursor_title(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().map_while(Result::ok).take(80) {
        let json: Value = serde_json::from_str(&line).ok()?;
        if json.get("role").and_then(Value::as_str) != Some("user") {
            continue;
        }
        if let Some(title) = json
            .get("message")
            .and_then(message_text)
            .and_then(cursor_clean_user_title)
        {
            return Some(title);
        }
    }
    None
}

fn cursor_clean_user_title(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let inner = trimmed
        .strip_prefix("<user_query>")
        .and_then(|rest| rest.strip_suffix("</user_query>"))
        .map(str::trim)
        .unwrap_or(trimmed);
    clean_title(inner)
}

fn gemini_sessions(workspace: &Path) -> Vec<LaunchSession> {
    let Some(slug) = gemini_project_slug(workspace) else {
        return Vec::new();
    };
    let chats_dir = config::home_dir()
        .join(".gemini")
        .join("tmp")
        .join(slug)
        .join("chats");
    let Ok(entries) = fs::read_dir(chats_dir) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?;
            if !name.starts_with("session-")
                || path.extension().and_then(|ext| ext.to_str()) != Some("json")
            {
                return None;
            }
            let data = fs::read_to_string(&path).ok()?;
            let json: Value = serde_json::from_str(&data).ok()?;
            let session_id = json.get("sessionId").and_then(Value::as_str)?.to_string();
            let title =
                gemini_title(&json).unwrap_or_else(|| fallback_title(workspace, &session_id));
            Some(LaunchSession {
                agent_id: "gemini".to_string(),
                session_id,
                title,
                workspace: workspace.to_string_lossy().to_string(),
                updated_at: modified_secs(&path),
                source: "gemini".to_string(),
                archived: false,
            })
        })
        .collect()
}

fn gemini_project_slug(workspace: &Path) -> Option<String> {
    let projects_path = config::home_dir().join(".gemini").join("projects.json");
    let data = fs::read_to_string(projects_path).ok()?;
    let json: Value = serde_json::from_str(&data).ok()?;
    let workspace = workspace.to_string_lossy();
    json.get("projects")?
        .get(workspace.as_ref())?
        .as_str()
        .map(ToOwned::to_owned)
}

fn gemini_title(json: &Value) -> Option<String> {
    let messages = json.get("messages")?.as_array()?;
    for message in messages {
        if message.get("type").and_then(Value::as_str) != Some("user") {
            continue;
        }
        let content = message.get("content")?.as_array()?;
        for item in content {
            if let Some(title) = item
                .get("text")
                .and_then(Value::as_str)
                .and_then(clean_title)
            {
                return Some(title);
            }
        }
    }
    None
}

fn opencode_sessions(workspace: &Path) -> Vec<LaunchSession> {
    let Ok(output) = Command::new("opencode")
        .args(["session", "list", "--format", "json"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() || output.stdout.is_empty() {
        return Vec::new();
    }
    let Ok(json) = serde_json::from_slice::<Value>(&output.stdout) else {
        return Vec::new();
    };
    let Some(items) = json.as_array() else {
        return Vec::new();
    };
    let workspace_str = workspace.to_string_lossy();

    items
        .iter()
        .filter_map(|item| {
            if item.get("directory").and_then(Value::as_str) != Some(workspace_str.as_ref()) {
                return None;
            }
            let session_id = item.get("id").and_then(Value::as_str)?.to_string();
            let title = item
                .get("title")
                .and_then(Value::as_str)
                .and_then(clean_title)
                .unwrap_or_else(|| fallback_title(workspace, &session_id));
            Some(LaunchSession {
                agent_id: "opencode".to_string(),
                session_id,
                title,
                workspace: workspace.to_string_lossy().to_string(),
                updated_at: item
                    .get("updated")
                    .and_then(Value::as_u64)
                    .map(timestamp_secs)
                    .unwrap_or(0),
                source: "opencode".to_string(),
                archived: false,
            })
        })
        .collect()
}

fn qwen_sessions(workspace: &Path) -> Vec<LaunchSession> {
    let chats_dir = config::home_dir()
        .join(".qwen")
        .join("projects")
        .join(claude_encoded_cwd(workspace))
        .join("chats");
    let Ok(entries) = fs::read_dir(chats_dir) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                return None;
            }
            let fallback_id = path.file_stem()?.to_str()?.to_string();
            let session_id = qwen_session_id(&path).unwrap_or(fallback_id);
            let title = qwen_title(&path).unwrap_or_else(|| fallback_title(workspace, &session_id));
            Some(LaunchSession {
                agent_id: "qwen-code".to_string(),
                session_id,
                title,
                workspace: workspace.to_string_lossy().to_string(),
                updated_at: modified_secs(&path),
                source: "qwen-code".to_string(),
                archived: false,
            })
        })
        .collect()
}

fn qwen_session_id(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().map_while(Result::ok).take(20) {
        let json: Value = serde_json::from_str(&line).ok()?;
        if let Some(session_id) = json.get("sessionId").and_then(Value::as_str) {
            return Some(session_id.to_string());
        }
    }
    None
}

fn qwen_title(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().map_while(Result::ok).take(80) {
        let json: Value = serde_json::from_str(&line).ok()?;
        if json.get("type").and_then(Value::as_str) != Some("user") {
            continue;
        }
        if let Some(title) = json
            .get("message")
            .and_then(message_text)
            .and_then(clean_title)
        {
            return Some(title);
        }
    }
    None
}

fn message_text(message: &Value) -> Option<&str> {
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

fn walk_files(dir: &Path, visit: &mut impl FnMut(&Path)) {
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

fn modified_secs(path: &Path) -> u64 {
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

fn timestamp_secs(value: u64) -> u64 {
    if value > 1_000_000_000_000 {
        value / 1_000
    } else {
        value
    }
}

fn clean_title(value: &str) -> Option<String> {
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

fn fallback_title(workspace: &Path, session_id: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn codex_title_skips_environment_context() {
        let payload = json!({
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "<environment_context>\n  <cwd>/tmp/project</cwd>\n</environment_context>"
                }
            ]
        });

        assert_eq!(codex_user_message_title(&payload), None);
    }

    #[test]
    fn codex_title_uses_real_user_message() {
        let payload = json!({
            "type": "user_message",
            "message": "hello \u{5440}"
        });

        assert_eq!(
            codex_user_message_title(&payload),
            Some("hello \u{5440}".to_string())
        );
    }

    #[test]
    fn cursor_title_strips_user_query_wrapper() {
        assert_eq!(
            cursor_clean_user_title("<user_query>\nhello cursor\n</user_query>"),
            Some("hello cursor".to_string())
        );
    }

    #[test]
    fn qwen_message_text_reads_parts() {
        let message = json!({
            "role": "user",
            "parts": [{ "text": "hello qwen" }]
        });

        assert_eq!(message_text(&message), Some("hello qwen"));
    }
}
