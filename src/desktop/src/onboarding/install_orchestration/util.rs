//! Shared helpers for install orchestration: progress emission, log
//! line append, and enabled-agent resolution.

use std::io::Write as _;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::Mutex;

use crate::onboarding::InstallProgressEvent;

pub(super) fn emit_progress<R: Runtime>(app: &AppHandle<R>, event: &InstallProgressEvent) {
    let _ = app.emit("onboarding-install-progress", event);
}

pub(super) fn log_line(log_file: &Arc<Mutex<Option<std::fs::File>>>, line: &str) {
    if let Ok(mut guard) = log_file.try_lock() {
        if let Some(ref mut f) = *guard {
            let _ = writeln!(f, "{}", line);
        }
    }
}

pub(super) fn log_command_output_summary(
    log_file: &Arc<Mutex<Option<std::fs::File>>>,
    label: &str,
    stdout: &str,
    stderr: &str,
) {
    if let Some(excerpt) = compact_output_excerpt("stdout", stdout) {
        log_line(log_file, &format!("[{}] {}", label, excerpt));
    }
    if let Some(excerpt) = compact_output_excerpt("stderr", stderr) {
        log_line(log_file, &format!("[{}] {}", label, excerpt));
    }
}

pub(super) fn output_excerpt(label: &str, output: &str) -> Option<String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }

    const MAX_CHARS: usize = 4000;
    let mut excerpt = trimmed.to_string();
    if excerpt.chars().count() > MAX_CHARS {
        excerpt = format!("...{}", tail_chars(&excerpt, MAX_CHARS));
    }
    Some(format!("{label}:\n{excerpt}"))
}

fn compact_output_excerpt(label: &str, output: &str) -> Option<String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }

    const MAX_CHARS: usize = 1200;
    let mut excerpt = trimmed.to_string();
    if excerpt.chars().count() > MAX_CHARS {
        excerpt = format!("...{}", tail_chars(&excerpt, MAX_CHARS));
    }
    Some(format!("{label} tail:\n{excerpt}"))
}

fn tail_chars(value: &str, max_chars: usize) -> String {
    let mut tail = value.chars().rev().take(max_chars).collect::<Vec<_>>();
    tail.reverse();
    tail.into_iter().collect()
}

pub(super) fn resolve_enabled_agents(settings: &Value, all_agents: &[&str]) -> Vec<String> {
    common::agent::resolve_enabled_agents(settings, all_agents)
}
