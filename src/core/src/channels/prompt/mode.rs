//! `/mode <id>` slash-command handling.
//!
//! Validates the requested mode ID, canonicalises common aliases
//! (`accept-edits` → `acceptEdits` etc.), dispatches to the ACP
//! `set_session_mode` endpoint, and sends a confirmation line so the
//! user sees their command was accepted even before the agent's
//! `current_mode_update` notification arrives.

use std::sync::Arc;

use crate::channels::plugin_host::PluginHost;
use crate::conversations::ConversationManager;
use crate::routing::RouteKey;

use super::send_system_text;

/// Validate + canonicalise the mode ID from `/mode <id>`, then dispatch.
pub(super) async fn handle_set_mode(
    conversation_manager: &Arc<ConversationManager>,
    plugin_host: &Arc<PluginHost>,
    route: &RouteKey,
    mode_id: &str,
) {
    const VALID: &[&str] = &[
        "default",
        "plan",
        "acceptEdits",
        "bypassPermissions",
        "dontAsk",
    ];
    let canonical = match mode_id {
        "accept_edits" | "accept-edits" | "accept" => "acceptEdits",
        "bypass_permissions" | "bypass-permissions" | "bypass" => "bypassPermissions",
        "dont_ask" | "dont-ask" | "dontask" => "dontAsk",
        other => other,
    };
    if !VALID.contains(&canonical) {
        send_system_text(
            plugin_host,
            route,
            &format!("Unknown mode `{}`. Valid: {}.", mode_id, VALID.join(", ")),
        )
        .await;
    } else {
        set_session_mode_and_reply(conversation_manager, plugin_host, route, canonical).await;
    }
}

/// Call `set_session_mode` on the current pod and report the outcome via
/// system text. Relies on the agent to emit `current_mode_update` which
/// the plugin SDK renders as a mode badge — we only send a confirmation
/// line here so the user sees their command was accepted even before
/// the agent replies.
pub(super) async fn set_session_mode_and_reply(
    conversation_manager: &Arc<ConversationManager>,
    plugin_host: &Arc<PluginHost>,
    route: &RouteKey,
    mode_id: &str,
) {
    match conversation_manager
        .set_session_mode(route, mode_id.to_string())
        .await
    {
        Ok(_) => {
            send_system_text(
                plugin_host,
                route,
                &format!("✅ Mode switched to `{}`.", mode_id),
            )
            .await;
        }
        Err(error) => {
            send_system_text(
                plugin_host,
                route,
                &format!(
                    "❌ Could not switch mode to `{}`: {}. Start a conversation first, then try `/mode {}`.",
                    mode_id, error, mode_id,
                ),
            )
            .await;
        }
    }
}
