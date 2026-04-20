//! Subprocess management — command builder + live child registry.
//!
//! These two modules are always used together in the codebase. `env`
//! builds a `tokio::process::Command` / `std::process::Command` with the
//! user's full login-shell environment injected (so GUI-launched Tauri
//! apps inherit PATH / NVM / API keys). `registry` takes ownership of
//! the spawned `Child` in a global table so that daemon shutdown can
//! synchronously SIGKILL every live subprocess regardless of tokio
//! task-poll order.

pub mod env;
pub mod registry;
