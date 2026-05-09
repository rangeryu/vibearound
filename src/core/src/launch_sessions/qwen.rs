use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::config;

use super::{
    clean_title, dash_encoded_cwd, fallback_title, message_text, modified_secs, LaunchSession,
};

pub(super) fn sessions(workspace: &Path) -> Vec<LaunchSession> {
    let chats_dir = config::home_dir()
        .join(".qwen")
        .join("projects")
        .join(dash_encoded_cwd(workspace))
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
            let session_id = session_id(&path).unwrap_or(fallback_id);
            let title = title(&path).unwrap_or_else(|| fallback_title(workspace, &session_id));
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

fn session_id(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().map_while(Result::ok).take(20) {
        let json: Value = serde_json::from_str(&line).ok()?;
        if let Some(session_id) = json.get("sessionId").and_then(Value::as_str) {
            return Some(session_id.to_string());
        }
    }
    None
}

fn title(path: &Path) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::message_text;

    #[test]
    fn message_text_reads_parts() {
        let message = json!({
            "role": "user",
            "parts": [{ "text": "hello qwen" }]
        });

        assert_eq!(message_text(&message), Some("hello qwen"));
    }
}
