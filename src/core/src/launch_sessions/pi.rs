use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::config;

use super::{clean_title, fallback_title, message_text, modified_secs, walk_files, LaunchSession};

pub(super) fn sessions(workspace: &Path) -> Vec<LaunchSession> {
    let root = config::home_dir()
        .join(".pi")
        .join("agent")
        .join("sessions");
    let mut out = Vec::new();
    walk_files(&root, &mut |path| {
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            return;
        }
        if let Some(session) = session_from_file(path, workspace) {
            out.push(session);
        }
    });
    out
}

fn session_from_file(path: &Path, workspace: &Path) -> Option<LaunchSession> {
    let file = fs::File::open(path).ok()?;
    let workspace_str = workspace.to_string_lossy();
    let mut session_id: Option<String> = None;
    let mut session_cwd: Option<String> = None;
    let mut first_user_title: Option<String> = None;

    for line in BufReader::new(file).lines().map_while(Result::ok).take(600) {
        let Ok(json) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        if json.get("type").and_then(Value::as_str) == Some("session") {
            if session_id.is_none() {
                session_id = json
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
            }
            if session_cwd.is_none() {
                session_cwd = json
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
            }
        }

        if first_user_title.is_none()
            && json.get("type").and_then(Value::as_str) == Some("message")
            && json
                .get("message")
                .and_then(|message| message.get("role"))
                .and_then(Value::as_str)
                == Some("user")
        {
            first_user_title = json
                .get("message")
                .and_then(message_text)
                .and_then(clean_title);
        }
    }

    let session_id = session_id.or_else(|| path.file_stem()?.to_str().map(ToOwned::to_owned))?;
    if session_cwd.as_deref() != Some(workspace_str.as_ref()) {
        return None;
    }
    let title = first_user_title.unwrap_or_else(|| fallback_title(workspace, &session_id));

    Some(LaunchSession {
        agent_id: "pi".to_string(),
        session_id,
        title,
        workspace: workspace.to_string_lossy().to_string(),
        updated_at: modified_secs(path),
        source: "pi".to_string(),
        archived: false,
    })
}
