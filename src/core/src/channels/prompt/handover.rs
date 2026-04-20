//! Direction-2 session handover: generate a resume command the user
//! can paste into their terminal to continue the current session in a
//! coding-agent CLI.

use std::sync::Arc;

use crate::channels::plugin_host::PluginHost;
use crate::conversations::{handover, ConversationManager};
use crate::routing::RouteKey;

use super::send_system_text;

/// Export the current session to a coding agent CLI by sending the user
/// a resume command template (pulled from `agents.json`). Silently no-ops
/// if there's no active session yet.
pub(super) async fn handle_handover(
    conversation_manager: &Arc<ConversationManager>,
    plugin_host: &Arc<PluginHost>,
    route: &RouteKey,
) {
    let conv_state = match conversation_manager.conversation(route) {
        Some(conv) => Some(conv.state().await),
        None => None,
    };
    match conv_state {
        Some(snap) if snap.session_id.is_some() => {
            let session_id = snap.session_id.unwrap();
            let cwd = snap.workspace.unwrap_or_else(|| "~".to_string());
            let cli_kind = snap.cli_kind.unwrap_or_else(|| "claude".to_string());
            let resume_cmd = handover::resume_command_for(&cli_kind, &session_id, &cwd);
            send_system_text(
                plugin_host,
                route,
                &format!(
                    "Run this in your terminal to continue the session:\n\n{}\n\nYou can close this chat after resuming.",
                    resume_cmd
                ),
            )
            .await;
        }
        _ => {
            send_system_text(
                plugin_host,
                route,
                "No active session to hand over. Send a message first to start a session.",
            )
            .await;
        }
    }
}
