use std::sync::atomic::{AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use parking_lot::{Mutex, RwLock};

use crate::pty::unix_now_secs;

use super::super::manifest::ChannelPluginManifest;
use super::super::transport_stdio::StdioPluginRuntime;

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelRunStatus {
    NotStarted = 0,
    Spawning = 1,
    Running = 2,
    Crashed = 3,
    Stopped = 4,
}

impl ChannelRunStatus {
    pub(super) fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::NotStarted,
            1 => Self::Spawning,
            2 => Self::Running,
            3 => Self::Crashed,
            _ => Self::Stopped,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotStarted => "not_started",
            Self::Spawning => "spawning",
            Self::Running => "running",
            Self::Crashed => "crashed",
            Self::Stopped => "stopped",
        }
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TransitionIntent {
    None = 0,
    Stop = 1,
    Restart = 2,
}

impl TransitionIntent {
    pub(super) fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Stop,
            2 => Self::Restart,
            _ => Self::None,
        }
    }
}

pub(super) struct ChannelState {
    pub(super) kind: String,
    pub(super) manifest: ChannelPluginManifest,

    /// `ChannelRunStatus` stored as atomic for lock-free reads in tick/snapshot.
    pub(super) status: AtomicU8,

    /// `TransitionIntent` consumed by `mark_crashed` to distinguish user
    /// actions from actual crashes.
    pub(super) intent: AtomicU8,

    /// Human-readable last transition reason displayed on Dashboard.
    reason: RwLock<String>,

    /// Unix secs of last `_va/heartbeat` receipt.
    pub(super) last_seen_ts: AtomicU64,

    /// Unix secs of last crash. Purely informational for Dashboard.
    pub(super) last_crash_ts: AtomicU64,

    /// How many times this channel has crashed since daemon start.
    pub(super) crash_count: AtomicU32,

    /// Unix secs at which a respawn should be attempted. `0` means "not
    /// scheduled" (e.g. already running, or user-stopped).
    pub(super) restart_at: AtomicU64,

    /// Arc to the currently-active `StdioPluginRuntime`. Swapped on respawn.
    pub(super) current_runtime: Mutex<Option<Arc<StdioPluginRuntime>>>,
}

impl ChannelState {
    pub(super) fn new(manifest: ChannelPluginManifest) -> Self {
        Self {
            kind: manifest.channel_kind.clone(),
            manifest,
            status: AtomicU8::new(ChannelRunStatus::NotStarted as u8),
            intent: AtomicU8::new(TransitionIntent::None as u8),
            reason: RwLock::new(String::new()),
            last_seen_ts: AtomicU64::new(unix_now_secs()),
            last_crash_ts: AtomicU64::new(0),
            crash_count: AtomicU32::new(0),
            restart_at: AtomicU64::new(0),
            current_runtime: Mutex::new(None),
        }
    }

    pub fn run_status(&self) -> ChannelRunStatus {
        ChannelRunStatus::from_u8(self.status.load(Ordering::Acquire))
    }

    pub(super) fn set_status(&self, status: ChannelRunStatus) {
        self.status.store(status as u8, Ordering::Release);
    }

    pub(super) fn set_reason(&self, reason: impl Into<String>) {
        *self.reason.write() = reason.into();
    }

    pub fn reason_snapshot(&self) -> String {
        self.reason.read().clone()
    }
}

#[derive(Debug, Clone)]
pub struct ChannelStatusSnapshot {
    pub kind: String,
    pub status: ChannelRunStatus,
    pub reason: String,
    pub crash_count: u32,
    pub last_seen_age_secs: u64,
    pub restart_in_secs: u64,
    pub started_at: u64,
}
