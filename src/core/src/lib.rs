//! VibeAround core: conversation manager, agents, channels, PTY, tunnels, workspace. No UI, no HTTP.

pub mod agent;
pub mod auth;
pub mod channel_manager;
pub mod config;
pub mod conversation_manager;
pub mod logging;
pub mod plugins;
pub mod preview_manager;
pub mod process;
pub mod pty;
pub mod resources;
pub mod routing;
pub mod state;
pub mod tunnel_manager;
