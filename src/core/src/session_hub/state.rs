//! Route state: per-route lifecycle, prompt queue, and runtime binding.

use std::collections::VecDeque;
use std::sync::Arc;

use tokio::sync::{Mutex, Notify};

use crate::acp::routing::RouteKey;
use crate::agent_manager::runtime::AcpBridge;

/// Per-route state held by SessionHub.
pub struct RouteState {
    pub route: RouteKey,
    pub in_flight: Mutex<bool>,
    pub pending: Mutex<VecDeque<Arc<QueuedPrompt>>>,
    pub runtime: Mutex<RouteRuntimeState>,
}

impl RouteState {
    pub fn new(route: RouteKey) -> Self {
        Self {
            route,
            in_flight: Mutex::new(false),
            pending: Mutex::new(VecDeque::new()),
            runtime: Mutex::new(RouteRuntimeState::default()),
        }
    }
}

/// A queued prompt waiting for its turn.
pub struct QueuedPrompt {
    pub notify: Notify,
}

impl QueuedPrompt {
    pub fn new() -> Self {
        Self {
            notify: Notify::new(),
        }
    }
}

/// Runtime identity for the agent attached to a route.
#[derive(Default)]
pub struct RouteRuntimeState {
    pub bridge: Option<Arc<AcpBridge>>,
    pub session_id: Option<String>,
    pub cli_session_id: Option<String>,
    pub cli_kind: Option<String>,
    pub profile: Option<String>,
    pub initialize: Option<agent_client_protocol::InitializeResponse>,
}
