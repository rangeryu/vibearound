use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::config;

use super::{
    clean_title, dash_encoded_cwd, fallback_title, message_text, modified_secs, LaunchSession,
};

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
    for line in BufReader::new(file).lines().map_while(Result::ok).take(600) {
        let Ok(json) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if json.get("type").and_then(Value::as_str) != Some("user")
            || json.get("isMeta").and_then(Value::as_bool).unwrap_or(false)
        {
            continue;
        }
        let Some(message) = json.get("message") else {
            continue;
        };
        if message.get("role").and_then(Value::as_str) != Some("user") {
            continue;
        }
        let Some(text) = message_text(message) else {
            continue;
        };
        if is_claude_context(text) {
            continue;
        }
        if let Some(title) = clean_title(text) {
            return Some(title);
        }
    }
    None
}

fn is_claude_context(value: &str) -> bool {
    let lower = value.trim_start().to_ascii_lowercase();
    if lower.starts_with("<system-reminder")
        || lower.contains("this file provides guidance to claude code")
    {
        return true;
    }
    let first_line = lower.lines().map(str::trim).find(|line| !line.is_empty());
    let Some(file) = first_line else {
        return false;
    };
    let file = file
        .trim_start_matches('#')
        .trim()
        .trim_matches('`')
        .trim_matches('"')
        .trim_matches('\'')
        .trim();

    matches!(
        file.rsplit(['/', '\\']).next().unwrap_or(file),
        "agents.md" | "claude.md" | "claude.local.md"
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;

    use super::title;

    #[test]
    fn title_reads_past_claude_project_context() {
        let path = std::env::temp_dir().join(format!(
            "vibearound-claude-title-{}.jsonl",
            std::process::id()
        ));
        let context = json!({
            "type": "user",
            "message": { "role": "user", "content": "CLAUDE.md\nProject instructions" }
        });
        let prompt = json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    { "type": "text", "text": "Investigate issue 68" }
                ]
            }
        });
        fs::write(&path, format!("{context}\n{prompt}\n")).expect("write test transcript");

        let result = title(&path);
        let _ = fs::remove_file(&path);

        assert_eq!(result, Some("Investigate issue 68".to_string()));
    }
}
