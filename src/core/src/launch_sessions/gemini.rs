use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::config;

use super::{clean_title, fallback_title, modified_secs, LaunchSession};

pub(super) fn sessions(workspace: &Path) -> Vec<LaunchSession> {
    let Some(slug) = project_slug(workspace) else {
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
            let title = title(&json).unwrap_or_else(|| fallback_title(workspace, &session_id));
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

fn project_slug(workspace: &Path) -> Option<String> {
    let projects_path = config::home_dir().join(".gemini").join("projects.json");
    let data = fs::read_to_string(projects_path).ok()?;
    let json: Value = serde_json::from_str(&data).ok()?;
    let workspace = workspace.to_string_lossy();
    json.get("projects")?
        .get(workspace.as_ref())?
        .as_str()
        .map(ToOwned::to_owned)
}

fn title(json: &Value) -> Option<String> {
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
