//! Standalone VibeAround server binary — starts the ServerDaemon from the command line.

use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    common::logging::init();
    let port = std::env::var("VIBEAROUND_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(common::config::DEFAULT_PORT);
    let daemon = server::ServerDaemon::new(port);
    let dist_path = PathBuf::from("web").join("dist");

    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async {
        if let Err(e) = daemon.start(dist_path).await {
            tracing::info!("[VibeAround] Fatal: {}", e);
        }
    });

    std::process::exit(0);
}
