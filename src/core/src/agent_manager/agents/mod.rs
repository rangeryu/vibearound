//! Shared agent helpers.
//!
//! Current live implementations:
//! - `runtime_context`: shared MCP config and system prompt helpers
//!
//! Gemini and OpenCode use the generic `StdioAcpProvider` in `provider.rs`.
//! Claude and Codex are currently placeholders and intentionally unimplemented.

pub mod runtime_context;

pub use crate::agent_manager::provider::AgentKind;
