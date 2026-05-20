//! Runtime state view of a [`Conversation`].
//!
//! [`Conversation`]: super::Conversation

use agent_client_protocol::schema as acp;

/// Mutable runtime fields of a conversation. Consumers (dashboard, TUI,
/// CLI) that want a consistent view of the current state call
/// `Conversation::state().await` and get a clone of this struct.
///
/// Immutable fields (`route`, `started_at`, `bot_identity`) live directly
/// on `Conversation` and are read without going through the state snapshot.
#[derive(Debug, Clone, Default)]
pub struct ConversationState {
    pub cli_kind: Option<String>,
    pub profile: Option<String>,
    pub session_id: Option<String>,
    pub workspace: Option<String>,
    pub busy: bool,
    pub failed: Option<String>,
    pub initialize: Option<acp::InitializeResponse>,
    pub session_mode: Option<serde_json::Value>,
}
