//! Preview sessions — one per workspace (server) or file path (file).
//!
//! A unified [`PreviewSession`] models both live dev-server previews and
//! static file previews (e.g. rendered markdown). Each session has:
//!
//! - `id`              — the canonical path that identifies this preview
//!                       (workspace dir for `Server`, file path for `File`).
//! - `target`          — what to serve: `Server { port }` or `File`.
//! - `slug`            — stable, readable URL segment derived from `id`.
//!                       Full-path-based (slashes → `-`), so slugs are
//!                       globally unique and collision-proof.
//! - `share_key`       — ephemeral random token with 10-min TTL. Regenerated
//!                       once the previous key expires.
//!
//! URL structure (all routes under `/va/`):
//!
//! - Owner: `/preview/u/{slug}`        — permanent for the daemon lifetime
//! - Share: `/preview/s/{share_key}`   — 10-minute rotating token
//!
//! One `HashMap<PathBuf, PreviewSession>` backs everything. Lookups by
//! `slug` or `share_key` scan values — `n` is tiny (<20 typical).
//!
//! On daemon shutdown, [`shutdown_kill_all_ports`] SIGKILLs any process
//! listening on a tracked `Server` port so dev servers don't leak.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use rand::rngs::OsRng;
use rand::Rng;

// ---------------------------------------------------------------------------
// Public data model
// ---------------------------------------------------------------------------

/// What the preview serves.
#[derive(Debug, Clone)]
pub enum PreviewTarget {
    /// Reverse proxy to a running local dev server on `port`.
    Server { port: u16 },
    /// Render a file directly (e.g. markdown).
    File,
}

/// Legacy alias kept for callers that still use `PreviewKind`.
/// New code should prefer [`PreviewTarget`].
pub type PreviewKind = PreviewTarget;

/// Public view of a preview session, returned from lookups.
#[derive(Debug, Clone)]
pub struct PreviewEntry {
    /// Identity of the preview (workspace dir or file path).
    pub id: PathBuf,
    /// Containing workspace (== `id` for `Server`; parent dir for `File`).
    pub workspace: PathBuf,
    /// Human-readable display name.
    pub title: String,
    /// What to serve.
    pub target: PreviewTarget,
    /// When the session was created.
    pub created_at: Instant,
    /// When the current share key expires. For owner-slug lookups, a
    /// far-future sentinel (sessions themselves never expire until daemon exit).
    pub expires_at: Instant,
}

// ---------------------------------------------------------------------------
// Internal storage
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct PreviewSession {
    id: PathBuf,
    workspace: PathBuf,
    title: String,
    target: PreviewTarget,
    slug: String,
    share_key: Option<String>,
    share_expires_at: Option<Instant>,
    created_at: Instant,
}

const SHARE_TTL: Duration = Duration::from_secs(600);
const OWNER_FAR_FUTURE: Duration = Duration::from_secs(86_400);

/// Alphabet for random share keys: uppercase + digits, with ambiguous
/// I/O/0/1 removed.
const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

static SESSIONS: LazyLock<Mutex<HashMap<PathBuf, PreviewSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// ---------------------------------------------------------------------------
// Slug + key generation
// ---------------------------------------------------------------------------

/// Random 8-char share key (for `/s/{key}` URLs).
fn generate_share_key() -> String {
    let mut rng = OsRng;
    (0..8)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

/// Derive a stable, collision-free owner slug from a full path.
///
/// Strategy: lowercase the path, replace every non-alphanumeric character
/// with `-`, and collapse repeated dashes. Because the full path is
/// unique per session, two sessions can never share a slug.
///
/// Examples:
///
/// - `/Users/foo/my-app`              → `users-foo-my-app`
/// - `/Users/foo/my-app/README.md`    → `users-foo-my-app-readme-md`
fn slug_from_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let mut out = String::with_capacity(raw.len());
    let mut last_dash = true; // drops leading '-'
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() {
            out.extend(c.to_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "preview".to_string()
    } else {
        trimmed
    }
}

// ---------------------------------------------------------------------------
// Public API — create / refresh
// ---------------------------------------------------------------------------

/// Ensure a Server preview session exists for `workspace`. Returns
/// `(owner_slug, share_key)`. Calling twice for the same workspace
/// reuses the owner slug; the share key is refreshed if expired.
pub fn ensure_server(port: u16, workspace: PathBuf, title: String) -> (String, String) {
    let workspace = canonical(&workspace);
    ensure_session(workspace.clone(), workspace, title, PreviewTarget::Server { port })
}

/// Ensure a File preview session exists for `file`. Returns
/// `(owner_slug, share_key)`. Same file → same owner slug.
pub fn ensure_file(file: PathBuf, workspace: PathBuf, title: String) -> (String, String) {
    let file = canonical(&file);
    let workspace = canonical(&workspace);
    ensure_session(file, workspace, title, PreviewTarget::File)
}

fn canonical(p: &Path) -> PathBuf {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
}

fn ensure_session(
    id: PathBuf,
    workspace: PathBuf,
    title: String,
    target: PreviewTarget,
) -> (String, String) {
    let slug = slug_from_path(&id);
    let now = Instant::now();

    let mut sessions = SESSIONS.lock();
    let session = sessions
        .entry(id.clone())
        .or_insert_with(|| PreviewSession {
            id: id.clone(),
            workspace: workspace.clone(),
            title: title.clone(),
            target: target.clone(),
            slug: slug.clone(),
            share_key: None,
            share_expires_at: None,
            created_at: now,
        });

    // Refresh mutable fields on every call.
    session.workspace = workspace;
    session.title = title;
    session.target = target;

    // Reuse share key if still valid; otherwise rotate.
    let share_key = match (&session.share_key, session.share_expires_at) {
        (Some(k), Some(exp)) if exp > now => k.clone(),
        _ => {
            let k = generate_share_key();
            session.share_key = Some(k.clone());
            session.share_expires_at = Some(now + SHARE_TTL);
            k
        }
    };

    (slug, share_key)
}

// ---------------------------------------------------------------------------
// Public API — lookup
// ---------------------------------------------------------------------------

/// Look up a session by its permanent owner slug.
pub fn lookup_owner(slug: &str) -> Option<PreviewEntry> {
    let sessions = SESSIONS.lock();
    sessions
        .values()
        .find(|s| s.slug == slug)
        .map(|s| entry_from(s, Instant::now() + OWNER_FAR_FUTURE))
}

/// Look up a session by its ephemeral share key. Expired keys return `None`.
pub fn lookup_share(key: &str) -> Option<PreviewEntry> {
    let sessions = SESSIONS.lock();
    let now = Instant::now();
    sessions
        .values()
        .find(|s| match (&s.share_key, s.share_expires_at) {
            (Some(k), Some(exp)) => k == key && exp > now,
            _ => false,
        })
        .map(|s| entry_from(s, s.share_expires_at.unwrap_or(now)))
}

/// Unified lookup: tries owner slug then share key.
///
/// Used by the cookie-proxy fallback, which only knows the cookie value
/// and not which kind of slug it came from.
pub fn lookup(slug: &str) -> Option<PreviewEntry> {
    lookup_owner(slug).or_else(|| lookup_share(slug))
}

fn entry_from(session: &PreviewSession, expires_at: Instant) -> PreviewEntry {
    PreviewEntry {
        id: session.id.clone(),
        workspace: session.workspace.clone(),
        title: session.title.clone(),
        target: session.target.clone(),
        created_at: session.created_at,
        expires_at,
    }
}

// ---------------------------------------------------------------------------
// Shutdown — kill tracked dev-server ports
// ---------------------------------------------------------------------------

/// Snapshot of ports held by Server-kind sessions.
pub fn tracked_ports() -> Vec<u16> {
    SESSIONS
        .lock()
        .values()
        .filter_map(|s| match s.target {
            PreviewTarget::Server { port } => Some(port),
            PreviewTarget::File => None,
        })
        .collect()
}

/// Send SIGKILL to every process listening on a tracked Server port.
/// Best-effort; failures are logged. Clears the session map.
pub fn shutdown_kill_all_ports() {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let ports = tracked_ports();
    if ports.is_empty() {
        SESSIONS.lock().clear();
        return;
    }
    eprintln!(
        "[preview] shutdown: killing dev servers on ports {:?}",
        ports
    );

    let pids = pids_listening_on(&ports);
    if pids.is_empty() {
        eprintln!("[preview] shutdown: no live processes on tracked ports");
        SESSIONS.lock().clear();
        return;
    }

    let mut sys = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    for pid in pids {
        if let Some(proc_) = sys.process(sysinfo::Pid::from_u32(pid)) {
            let ok = proc_.kill();
            eprintln!(
                "[preview] shutdown: kill pid={} name={:?} ok={}",
                pid,
                proc_.name().to_string_lossy(),
                ok
            );
        }
    }

    SESSIONS.lock().clear();
}

#[cfg(unix)]
fn pids_listening_on(ports: &[u16]) -> Vec<u32> {
    use std::process::Command;
    let mut pids = Vec::new();
    for port in ports {
        let out = match Command::new("lsof")
            .args(["-nP", "-ti", &format!("tcp:{}", port), "-sTCP:LISTEN"])
            .output()
        {
            Ok(o) => o,
            Err(_) => continue,
        };
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Ok(pid) = line.trim().parse::<u32>() {
                pids.push(pid);
            }
        }
    }
    pids.sort_unstable();
    pids.dedup();
    pids
}

#[cfg(not(unix))]
fn pids_listening_on(_ports: &[u16]) -> Vec<u32> {
    // TODO: Windows via `netstat -ano` parsing.
    Vec::new()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_from_full_path_is_stable_and_unique() {
        assert_eq!(slug_from_path(Path::new("/tmp/my-app")), "tmp-my-app");
        assert_eq!(
            slug_from_path(Path::new("/tmp/my-app/README.md")),
            "tmp-my-app-readme-md"
        );
        // Two different paths never produce the same slug.
        assert_ne!(
            slug_from_path(Path::new("/a/readme.md")),
            slug_from_path(Path::new("/b/readme.md")),
        );
    }

    #[test]
    fn ensure_server_is_idempotent() {
        let path = std::env::temp_dir().join("va-preview-test-server");
        std::fs::create_dir_all(&path).unwrap();

        let (slug_a, share_a) = ensure_server(3000, path.clone(), "t".into());
        let (slug_b, share_b) = ensure_server(3000, path.clone(), "t".into());
        assert_eq!(slug_a, slug_b);
        assert_eq!(share_a, share_b);
    }

    #[test]
    fn ensure_file_is_idempotent_and_independent_of_server() {
        let dir = std::env::temp_dir().join("va-preview-test-file");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("README.md");
        std::fs::write(&file, "hi").unwrap();

        let (srv_slug, _) = ensure_server(4000, dir.clone(), "srv".into());
        let (file_slug_a, file_share_a) = ensure_file(file.clone(), dir.clone(), "md".into());
        let (file_slug_b, file_share_b) = ensure_file(file.clone(), dir.clone(), "md".into());

        assert_ne!(srv_slug, file_slug_a, "server and file share different ids");
        assert_eq!(file_slug_a, file_slug_b);
        assert_eq!(file_share_a, file_share_b);
    }

    #[test]
    fn lookup_resolves_owner_and_share() {
        let path = std::env::temp_dir().join("va-preview-test-lookup");
        std::fs::create_dir_all(&path).unwrap();

        let (slug, share) = ensure_server(4100, path.clone(), "x".into());
        assert!(lookup_owner(&slug).is_some());
        assert!(lookup_share(&share).is_some());
        assert!(lookup(&slug).is_some());
        assert!(lookup(&share).is_some());
    }
}
