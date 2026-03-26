//! Compatibility exports for legacy imports.
//!
//! New ACP-native code should prefer `crate::agent_manager::provider` and
//! `crate::agent_manager::runtime` directly.

pub mod claude_acp;
pub mod claude_sdk;
pub mod codex_acp;
pub mod gemini_acp;
pub mod opencode_acp;
pub mod runtime_context;

pub use crate::agent_manager::provider::AgentKind;
