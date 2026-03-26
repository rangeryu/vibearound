//! Shared ACP-facing interfaces for routing, transport, and errors.

pub mod errors;
pub mod routing;
pub mod sdk;
pub mod transport;

pub use errors::AcpError;
pub use routing::{
    AgentSessionRef, Attachment, ChannelKind, ChatId, CliSessionId, MessageId, RouteEnvelope,
    RouteKey, RuntimeId, SessionId, TurnId,
};
