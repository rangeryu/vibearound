use std::path::Path;
use std::process::Command;

use serde_json::Value;

use super::{clean_title, fallback_title, timestamp_secs, LaunchSession};

pub(super) fn sessions(workspace: &Path) -> Vec<LaunchSession> {
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
