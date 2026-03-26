use super::routing::{AgentSessionRef, RouteEnvelope, TurnId};

/// Minimal transport-level commands for ACP runtimes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportCommand {
    SendEnvelope {
        session: AgentSessionRef,
        envelope: RouteEnvelope,
    },
    CancelTurn {
        session: AgentSessionRef,
        turn_id: TurnId,
    },
    CloseSession {
        session: AgentSessionRef,
        reason: Option<String>,
    },
}
