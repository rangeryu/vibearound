//! Session auto-discovery for MCP handover.
//!
//! The actual agent-specific filesystem readers live in `common` so desktop
//! Launch, MCP handover, and future surfaces share one normalized view.

/// Find the most recent session ID for a given agent kind and workspace.
pub(super) fn find_latest_session(agent_kind: &str, cwd: &std::path::Path) -> Option<String> {
    common::launch_sessions::latest_for_agent_workspace(agent_kind, cwd)
        .map(|session| session.session_id)
}
