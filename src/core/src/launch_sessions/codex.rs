use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::config;

use super::{clean_title, fallback_title, modified_secs, walk_files, LaunchSession};

pub(super) fn sessions(workspace: &Path, include_archived: bool) -> Vec<LaunchSession> {
    let root = config::home_dir().join(".codex").join("sessions");
    let mut out = Vec::new();
    walk_files(&root, &mut |path| {
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            return;
        }
        if let Some(session) = session_from_file(path, workspace, false) {
            out.push(session);
        }
    });
    if include_archived {
        let archived_root = config::home_dir().join(".codex").join("archived_sessions");
        walk_files(&archived_root, &mut |path| {
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                return;
            }
            if let Some(session) = session_from_file(path, workspace, true) {
                out.push(session);
            }
        });
    }
    out
}

fn session_from_file(path: &Path, workspace: &Path, archived: bool) -> Option<LaunchSession> {
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
            first_user_title = user_message_title(payload);
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

fn user_message_title(payload: &Value) -> Option<String> {
    if payload.get("type").and_then(Value::as_str) == Some("user_message") {
        return payload
            .get("message")
            .and_then(Value::as_str)
            .and_then(clean_user_title);
    }

    if payload.get("role").and_then(Value::as_str) == Some("user") {
        if let Some(text) = payload
            .get("text")
            .and_then(Value::as_str)
            .and_then(clean_user_title)
        {
            return Some(text);
        }
        if let Some(content) = payload.get("content").and_then(Value::as_array) {
            for item in content {
                if let Some(text) = item
                    .get("text")
                    .and_then(Value::as_str)
                    .and_then(clean_user_title)
                {
                    return Some(text);
                }
            }
        }
    }

    None
}

fn clean_user_title(value: &str) -> Option<String> {
    let trimmed = value.trim_start();
    if trimmed.starts_with("<environment_context>")
        || trimmed.starts_with("<system_context>")
        || trimmed.starts_with("<developer_context>")
    {
        return None;
    }
    clean_title(value)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::user_message_title;

    #[test]
    fn title_skips_environment_context() {
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

        assert_eq!(user_message_title(&payload), None);
    }

    #[test]
    fn title_uses_real_user_message() {
        let payload = json!({
            "type": "user_message",
            "message": "hello \u{5440}"
        });

        assert_eq!(
            user_message_title(&payload),
            Some("hello \u{5440}".to_string())
        );
    }
}
