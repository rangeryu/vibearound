//! Session handover — two-sided workflow for moving an active agent
//! session between channels (CLI ↔ IM).
//!
//! ## Direction 1: CLI → IM (pickup)
//!
//! User invokes `/handover` as an MCP tool from their coding CLI. The
//! tool calls [`pickup_codes::store`] with the current
//! `(agent_kind, session_id, cwd)` and returns a 4-char code. The user
//! types `/pickup CODE` in any connected IM chat; the channel-side
//! slash handler calls [`pickup_codes::consume`] to resolve the triple
//! and then `ConversationManager::prepare_pickup` to wire it into a
//! fresh [`Conversation`]. The first prompt on that conversation
//! `load_session`s into the original session — and [`HandoverHandler`]
//! wrapping the downstream notification handler swallows the load
//! replay so existing history doesn't flood the IM feed.
//!
//! ## Direction 2: IM → CLI (resume command)
//!
//! User types `/handover` in IM. The channel-side handler reads the
//! current conversation state via `ConversationManager::conversation`
//! and asks [`resume_command_for`] to format a copy-pasteable resume
//! command from `resources/agents.json`. The user pastes the command
//! into their terminal and continues the session in their local CLI.
//!
//! [`Conversation`]: super::conversation::Conversation

pub mod handler;
pub mod pickup_codes;

pub(crate) use handler::HandoverHandler;

/// Format a copy-pasteable resume command for the given agent.
///
/// Looks up `agents.json::<agent>.resume_template` and substitutes
/// `{cwd}` and `{session_id}`. Falls back to a best-effort generic
/// command if no template is defined for this agent.
pub fn resume_command_for(cli_kind: &str, session_id: &str, cwd: &str) -> String {
    crate::resources::agent_by_id(cli_kind)
        .and_then(|a| a.resume_template.as_ref())
        .map(|tpl| {
            tpl.replace("{cwd}", cwd)
                .replace("{session_id}", session_id)
        })
        .unwrap_or_else(|| format!("cd {} && {} (resume session {})", cwd, cli_kind, session_id))
}
