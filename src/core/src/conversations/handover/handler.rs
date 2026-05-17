//! `HandoverHandler` — the [`AgentClientHandler`] wrapper that
//! [`Conversation`] installs on the downstream channel handler.
//!
//! It passes `session_notification` and `request_permission` through to
//! the real channel-side handler, except during handover `load_session`,
//! when the `suppress_replay` flag is set to swallow replayed history so
//! it doesn't flood the IM channel.
//!
//! [`Conversation`]: super::super::conversation::Conversation

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use agent_client_protocol::schema as acp;

use crate::agent::AgentClientHandler;

pub(crate) struct HandoverHandler {
    pub(crate) downstream: Arc<dyn AgentClientHandler>,
    /// When true, session_notification events are swallowed (not forwarded
    /// to IM). Used during handover load_session to suppress history replay.
    pub(crate) suppress_replay: Arc<AtomicBool>,
}

#[async_trait::async_trait]
impl AgentClientHandler for HandoverHandler {
    async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
        // During handover load_session, suppress replay notifications
        // so history doesn't flood the IM channel.
        if self.suppress_replay.load(Ordering::Acquire) {
            return Ok(());
        }

        // Forward to channel handler
        self.downstream.session_notification(args).await
    }

    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        self.downstream.request_permission(args).await
    }
}
