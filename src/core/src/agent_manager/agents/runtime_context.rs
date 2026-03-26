//! Minimal runtime context and MCP config generation for agents.

use super::AgentKind;
use std::path::Path;

/// Build the minimal runtime context injected into agent CLIs.
pub fn build_runtime_context(channel_kind: &str) -> String {
    format!(
        "You are running inside VibeAround.\nUser messages are relayed through an IM channel.\nCurrent channel: {}",
        channel_kind
    )
}

/// Ensure the MCP config file for the given agent kind exists in the workspace.
/// Called before starting the backend. Only writes if the file doesn't already exist.
pub fn ensure_mcp_config(kind: AgentKind, workspace: &Path, port: u16) {
    let url = format!("http://127.0.0.1:{}/mcp", port);

    let (rel_path, content) = match kind {
        AgentKind::Gemini => (
            ".gemini/settings.json",
            format!(
                r#"{{"mcpServers":{{"vibearound":{{"httpUrl":"{}"}}}}}}"#,
                url
            ),
        ),
        AgentKind::OpenCode => (
            "opencode.json",
            format!(
                r#"{{"mcp":{{"vibearound":{{"type":"remote","url":"{}","enabled":true}}}}}}"#,
                url
            ),
        ),
        AgentKind::Claude | AgentKind::Codex => {
            return;
        }
    };

    let path = workspace.join(rel_path);
    if path.exists() {
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&path, &content) {
        eprintln!("[VibeAround] Failed to write MCP config {:?}: {}", path, e);
    } else {
        eprintln!("[VibeAround] Wrote MCP config for {} at {:?}", kind, path);
    }
}
