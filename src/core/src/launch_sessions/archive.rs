use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::config;

static ARCHIVE_STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Default, Deserialize, Serialize)]
struct ArchiveStore {
    #[serde(default)]
    sessions: Vec<ArchivedSession>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ArchivedSession {
    agent_id: String,
    workspace: String,
    session_id: String,
    archived_at: u64,
}

impl ArchiveStore {
    fn insert(&mut self, agent_id: &str, workspace: &str, session_id: &str) {
        self.sessions.retain(|session| {
            !(session.agent_id == agent_id
                && session.workspace == workspace
                && session.session_id == session_id)
        });
        self.sessions.push(ArchivedSession {
            agent_id: agent_id.to_string(),
            workspace: workspace.to_string(),
            session_id: session_id.to_string(),
            archived_at: now_secs(),
        });
    }

    fn remove(&mut self, agent_id: &str, session_id: &str) {
        self.sessions
            .retain(|session| !(session.agent_id == agent_id && session.session_id == session_id));
    }
}

pub(super) fn archived_session_ids(agent_id: &str) -> HashSet<String> {
    read_store()
        .sessions
        .into_iter()
        .filter(|session| session.agent_id == agent_id)
        .map(|session| session.session_id)
        .collect()
}

pub fn archive_session(agent_id: &str, workspace: &Path, session_id: &str) -> Result<(), String> {
    mutate_store(|store| store.insert(agent_id, &workspace_key(workspace), session_id))
}

pub fn unarchive_session(
    agent_id: &str,
    _workspace: &Path,
    session_id: &str,
) -> Result<(), String> {
    mutate_store(|store| store.remove(agent_id, session_id))
}

fn mutate_store(mutator: impl FnOnce(&mut ArchiveStore)) -> Result<(), String> {
    let _guard = ARCHIVE_STORE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut store = read_store_unlocked();
    mutator(&mut store);
    write_store_unlocked(&store)
}

fn read_store() -> ArchiveStore {
    let _guard = ARCHIVE_STORE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    read_store_unlocked()
}

fn read_store_unlocked() -> ArchiveStore {
    let path = store_path();
    let Ok(data) = fs::read_to_string(path) else {
        return ArchiveStore::default();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn write_store_unlocked(store: &ArchiveStore) -> Result<(), String> {
    let path = store_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create archive store dir: {error}"))?;
    }
    let data = serde_json::to_string_pretty(store)
        .map_err(|error| format!("failed to serialize archive store: {error}"))?;
    fs::write(&path, data).map_err(|error| format!("failed to write archive store: {error}"))?;
    if let Err(error) = crate::auth::set_owner_only(&path) {
        tracing::warn!(
            "[VibeAround] failed to restrict launch session archive store {:?}: {}",
            path,
            error
        );
    }
    Ok(())
}

fn store_path() -> std::path::PathBuf {
    config::data_dir().join("launch-session-archive.json")
}

fn workspace_key(workspace: &Path) -> String {
    trim_trailing_separators(workspace.to_string_lossy().as_ref())
}

fn trim_trailing_separators(value: &str) -> String {
    let mut out = value.trim().to_string();
    while out.len() > 1 && (out.ends_with('/') || out.ends_with('\\')) {
        out.pop();
    }
    out
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
