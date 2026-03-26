//! Minimal hub event types for service status tracking.
//!
//! The old ChannelEvent / AgentReplyEvent / AgentReply / AgentClosed / AgentReady
//! enums are removed. ACP events flow end-to-end without translation.

/// Hub-level lifecycle events for service status dashboard.
#[derive(Debug, Clone)]
pub enum HubEvent {
    OnAgentSpawned { key: String, kind: String },
    OnAgentKilled { key: String },
}
