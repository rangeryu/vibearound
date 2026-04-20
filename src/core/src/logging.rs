//! Global tracing subscriber setup.
//!
//! Call [`init`] once from the process entrypoint (desktop Tauri shell
//! or the standalone server binary). Subsequent calls from other code
//! paths are safe — we install the subscriber via
//! `tracing_subscriber::registry().try_init()` which returns an error on
//! second call rather than panicking.
//!
//! # Runtime controls
//!
//! The filter is driven by `RUST_LOG`. Without it, the default is
//! `info,common=debug` — the kernel gets verbose logs, everything else
//! (tokio internals, hyper, ACP crate) stays at info. Override via the
//! environment, e.g.
//!
//! ```sh
//! RUST_LOG=warn,common::channels=trace cargo run
//! ```

use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Install the global tracing subscriber. Safe to call multiple times —
/// only the first call takes effect.
pub fn init() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,common=debug"));

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(true)
                .with_line_number(false),
        )
        .try_init();
}
