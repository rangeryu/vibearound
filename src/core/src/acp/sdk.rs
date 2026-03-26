use super::routing::{AgentSessionRef, RouteEnvelope};

/// Minimal SDK-facing abstraction for ACP-backed agents.
pub trait AcpSdk {
    fn session_for_route(&self, envelope: &RouteEnvelope) -> Option<AgentSessionRef>;
}
