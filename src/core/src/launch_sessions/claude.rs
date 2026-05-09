use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::config;

use super::{clean_title, dash_encoded_cwd, fallback_title, modified_secs, LaunchSession};

pub(super) fn sessions(workspace: &Path) -> Vec<LaunchSession> {
    let session_dir = config::home_dir()
        .join(".claude")
        .join("projects")
        .join(dash_encoded_cwd(workspace));
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
            let title = title(&path).unwrap_or_else(|| fallback_title(workspace, &session_id));
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

fn title(path: &Path) -> Option<String> {
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
