//! Service status manager: lightweight status registry for Dashboard display.
//!
//! This is a pure "status board" — it does NOT manage service lifecycles.
//! Data is synced in by ServerDaemon via hub events.
//!
//! Sub-registries:
//! - `channels`: IM channel plugins (keyed by channel kind, e.g. "feishu")
//! - `agents`: agent processes (keyed by hub agent key, e.g. "feishu:oc_001:default:claude")
//! - `tunnel`: tunnel process (at most one entry)
//! - `pty`: PTY sessions (reuses existing SessionContext)

use std::sync::Arc;

use dashmap::DashMap;
use parking_lot::RwLock;
use serde::Serialize;
use tokio::sync::broadcast;
use tokio::task::AbortHandle;

// parking_lot locks used throughout this module are fast, uncontended, and
// cover very short critical sections. They are _blocking_ locks, so the
// invariant across every call site below is: NEVER hold a guard across an
// `.await` point. If a lock needs to be held longer, convert that specific
// site to `tokio::sync::RwLock` — do not yield while holding parking_lot.

use crate::pty::{unix_now_secs, Registry, SessionId};
use crate::runtime_status::RuntimeStatusStore;
use crate::tunnels::TunnelProvider;

// ---------------------------------------------------------------------------
// ServiceStatus + ServiceMeta
// ---------------------------------------------------------------------------

/// Runtime status of a managed service.
#[derive(Debug, Clone)]
pub enum ServiceStatus {
    Running,
    Stopped { reason: String },
    Failed { error: String },
}

impl ServiceStatus {
    pub fn is_running(&self) -> bool {
        matches!(self, ServiceStatus::Running)
    }
}

/// Common metadata shared by all service entry types.
pub struct ServiceMeta {
    pub status: Arc<RwLock<ServiceStatus>>,
    pub started_at: u64,
    /// Kill function — aborts the backing task.
    kill_fn: Option<Box<dyn Fn() + Send + Sync>>,
}

impl ServiceMeta {
    pub fn new(abort_handle: Option<AbortHandle>) -> Self {
        let kill_fn: Option<Box<dyn Fn() + Send + Sync>> = abort_handle.map(|h| {
            Box::new(move || h.abort()) as Box<dyn Fn() + Send + Sync>
        });
        Self {
            status: Arc::new(RwLock::new(ServiceStatus::Running)),
            started_at: unix_now_secs(),
            kill_fn,
        }
    }

    pub fn current_status(&self) -> ServiceStatus {
        self.status.read().clone()
    }

    pub fn uptime_secs(&self) -> u64 {
        unix_now_secs().saturating_sub(self.started_at)
    }

    pub fn kill(&self) {
        if let Some(f) = &self.kill_fn {
            f();
        }
        // Never hold this write guard across an .await — we drop it at end of scope.
        let mut s = self.status.write();
        *s = ServiceStatus::Stopped {
            reason: "killed".into(),
        };
    }
}

// ---------------------------------------------------------------------------
// Lightweight status entries (no backend, no heavy state)
// ---------------------------------------------------------------------------

/// Agent status entry (lightweight, for Dashboard display only).
#[derive(Debug, Clone, Serialize)]
pub struct AgentStatusEntry {
    pub key: String,
    pub kind: String,
    pub started_at: u64,
}

/// Channel plugin status entry.
pub struct ChannelEntry {
    pub meta: ServiceMeta,
}

/// Tunnel status entry.
pub struct TunnelEntry {
    pub meta: ServiceMeta,
    pub provider: TunnelProvider,
    pub url: Option<String>,
}

// ---------------------------------------------------------------------------
// ServiceStatusManager
// ---------------------------------------------------------------------------

/// Lightweight status registry for all running services.
/// Data is synced by ServerDaemon via hub events.
pub struct ServiceStatusManager {
    /// Runtime status store (event-driven, from ACPHub HubEvent stream).
    runtime_status: RwLock<Option<Arc<RuntimeStatusStore>>>,
    /// Channel plugin status (keyed by channel kind).
    channels: DashMap<String, ChannelEntry>,
    /// Tunnel status (at most one).
    tunnels: DashMap<String, TunnelEntry>,
    /// PTY sessions (reuses existing Registry).
    pub pty: Registry,
    /// Web server metadata.
    pub server_meta: ServerMeta,
    /// Convenience: the port the web server listens on.
    pub port: u16,
    /// Broadcast channel for real-time service status changes.
    change_tx: broadcast::Sender<()>,
}

/// Web server metadata (read-only).
#[derive(Debug, Clone, Serialize)]
pub struct ServerMeta {
    pub started_at: u64,
    pub port: u16,
}

impl ServiceStatusManager {
    pub fn new(port: u16) -> Self {
        let (change_tx, _) = broadcast::channel(64);
        Self {
            runtime_status: RwLock::new(None),
            channels: DashMap::new(),
            tunnels: DashMap::new(),
            pty: Arc::new(DashMap::new()),
            server_meta: ServerMeta {
                started_at: unix_now_secs(),
                port,
            },
            port,
            change_tx,
        }
    }

    /// Clear all service entries. Called on daemon stop to prevent stale
    /// entries from persisting across restarts.
    pub fn clear(&self) {
        self.channels.clear();
        self.tunnels.clear();
        self.pty.clear();
        *self.runtime_status.write() = None;
        self.notify_change();
    }

    // -----------------------------------------------------------------------
    // Change notification
    // -----------------------------------------------------------------------

    pub fn subscribe_changes(&self) -> broadcast::Receiver<()> {
        self.change_tx.subscribe()
    }

    pub fn notify_change(&self) {
        let _ = self.change_tx.send(());
    }

    /// Expose the change broadcast sender so RuntimeStatusStore can share it.
    pub fn change_tx(&self) -> broadcast::Sender<()> {
        self.change_tx.clone()
    }

    // -----------------------------------------------------------------------
    // Runtime status (event-driven from ACPHub)
    // -----------------------------------------------------------------------

    pub fn set_runtime_status(&self, store: Arc<RuntimeStatusStore>) {
        *self.runtime_status.write() = Some(store);
    }

    // -----------------------------------------------------------------------
    // Channels (registered by ServerDaemon after plugin start)
    // -----------------------------------------------------------------------

    pub fn register_channel(&self, kind: &str, abort_handle: AbortHandle) {
        let entry = ChannelEntry {
            meta: ServiceMeta::new(Some(abort_handle)),
        };
        self.channels.insert(kind.to_string(), entry);
        eprintln!("[ServiceStatus] registered channel: {}", kind);
        self.notify_change();
    }

    // -----------------------------------------------------------------------
    // Tunnel
    // -----------------------------------------------------------------------

    pub fn register_tunnel(&self, provider: TunnelProvider, abort_handle: AbortHandle) {
        let entry = TunnelEntry {
            meta: ServiceMeta::new(Some(abort_handle)),
            provider,
            url: None,
        };
        self.tunnels.insert(provider.as_str().to_string(), entry);
        self.notify_change();
    }

    pub fn set_tunnel_url(&self, provider_key: &str, url: &str) {
        if let Some(mut entry) = self.tunnels.get_mut(provider_key) {
            entry.url = Some(url.to_string());
            self.notify_change();
        }
    }

    pub fn has_tunnel_url(&self) -> bool {
        self.tunnels.iter().any(|entry| entry.url.is_some())
    }

    pub fn get_tunnel_url(&self) -> Option<String> {
        self.tunnels.iter().find_map(|entry| entry.url.clone())
    }

    // -----------------------------------------------------------------------
    // Kill
    // -----------------------------------------------------------------------

    pub fn kill_service(&self, category: &str, key: &str) -> bool {
        match category {
            "channels" => {
                if let Some(entry) = self.channels.get(key) {
                    entry.meta.kill();
                    self.notify_change();
                    return true;
                }
            }
            "tunnels" => {
                if let Some(entry) = self.tunnels.get(key) {
                    entry.meta.kill();
                    self.notify_change();
                    return true;
                }
            }
            "pty" => {
                if let Ok(uuid) = uuid::Uuid::parse_str(key) {
                    self.pty.remove(&SessionId(uuid));
                    self.notify_change();
                    return true;
                }
            }
            _ => {}
        }
        false
    }

    // -----------------------------------------------------------------------
    // Snapshot (for Dashboard API / WebSocket)
    // -----------------------------------------------------------------------

    pub fn snapshot(&self) -> StatusSnapshot {
        let pty_count = self.pty.len();

        let agents = self
            .runtime_status
            .read()
            .as_ref()
            .map(|store| store.snapshot_agents())
            .unwrap_or_default();

        StatusSnapshot {
            server: self.server_meta.clone(),
            tunnels: self.tunnels.iter().map(|entry| {
                let key = entry.key().clone();
                ServiceInfo {
                    id: key.clone(),
                    name: format!("Tunnel ({})", entry.provider.as_str()),
                    status: status_string(&entry.meta.current_status()),
                    uptime_secs: entry.meta.uptime_secs(),
                    extra: {
                        let mut m = serde_json::Map::new();
                        m.insert("provider".into(), entry.provider.as_str().into());
                        if let Some(ref url) = entry.url {
                            m.insert("url".into(), url.clone().into());
                        }
                        m
                    },
                }
            }).collect(),
            agents,
            channels: self.channels.iter().map(|entry| {
                let key = entry.key().clone();
                ServiceInfo {
                    id: key.clone(),
                    name: capitalize(&key),
                    status: status_string(&entry.meta.current_status()),
                    uptime_secs: entry.meta.uptime_secs(),
                    extra: serde_json::Map::new(),
                }
            }).collect(),
            pty_session_count: pty_count,
        }
    }
}

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

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
    pub status: String,
    pub uptime_secs: u64,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

pub fn status_string(s: &ServiceStatus) -> String {
    match s {
        ServiceStatus::Running => "running".into(),
        ServiceStatus::Stopped { reason } => format!("stopped: {}", reason),
        ServiceStatus::Failed { error } => format!("failed: {}", error),
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

/// Spawn a task that auto-updates the ServiceMeta status on completion.
pub fn spawn_tracked<F>(
    meta_status: Arc<RwLock<ServiceStatus>>,
    future: F,
) -> tokio::task::JoinHandle<()>
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    let status = meta_status;
    tokio::spawn(async move {
        future.await;
        // The future has finished — we're past the last await. Safe to take
        // the blocking parking_lot write guard inside this async block.
        let mut s = status.write();
        if s.is_running() {
            *s = ServiceStatus::Stopped {
                reason: "completed".into(),
            };
        }
    })
}
