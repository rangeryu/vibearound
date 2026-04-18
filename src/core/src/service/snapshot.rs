//! Snapshot types serialized to Dashboard API / WebSocket clients.

use serde::Serialize;

use super::status::ServiceStatus;

/// Web server metadata (read-only).
#[derive(Debug, Clone, Serialize)]
pub struct ServerMeta {
    pub started_at: u64,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusSnapshot {
    pub server: ServerMeta,
    pub tunnels: Vec<ServiceInfo>,
    pub agents: Vec<ServiceInfo>,
    pub channels: Vec<ServiceInfo>,
    pub pty_session_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServiceInfo {
    pub id: String,
    pub name: String,
    pub status: ApiServiceStatus,
    pub uptime_secs: u64,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Wire-level status across all service kinds (tunnels, agents, channels).
///
/// This unifies `ServiceStatus` (3 variants, for tunnels/agents) and
/// `ChannelRunStatus` (5 variants, for channel plugins) into one tagged
/// enum. The `state` discriminant lets the frontend pattern-match
/// exhaustively instead of reverse-parsing free-form strings.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(tag = "state", rename_all = "snake_case")]
#[ts(export)]
pub enum ApiServiceStatus {
    Running,
    Spawning,
    NotStarted,
    Stopped { reason: Option<String> },
    Failed { error: String },
    Crashed,
}

impl From<&ServiceStatus> for ApiServiceStatus {
    fn from(s: &ServiceStatus) -> Self {
        match s {
            ServiceStatus::Running => Self::Running,
            ServiceStatus::Stopped { reason } => Self::Stopped {
                reason: Some(reason.clone()),
            },
            ServiceStatus::Failed { error } => Self::Failed {
                error: error.clone(),
            },
        }
    }
}

pub(super) fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}
