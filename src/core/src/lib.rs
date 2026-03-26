//! VibeAround core: PTY, session registry, tunnels, IM, workspace. No UI, no HTTP.

pub mod acp;
pub mod config;
pub mod session_hub;
pub mod agent_manager;
pub mod channel_manager;
pub mod plugins;
pub mod pty;
pub mod service;
pub mod tunnels;
pub mod workspace;
