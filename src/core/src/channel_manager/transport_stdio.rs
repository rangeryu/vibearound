use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::AbortHandle;

use super::manifest::{ChannelPluginManifest, PluginHostHandshake};
use super::{ChannelInput, ChannelOutput};

#[derive(Debug)]
pub struct StdioPluginRuntime {
    channel_kind: String,
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    abort_handle: AbortHandle,
}

impl StdioPluginRuntime {
    pub async fn spawn(
        manifest: ChannelPluginManifest,
        input_tx: mpsc::UnboundedSender<ChannelInput>,
    ) -> Result<Self, String> {
        if manifest.runtime != "node" {
            return Err(format!(
                "unsupported channel runtime '{}' for {}",
                manifest.runtime, manifest.channel_kind
            ));
        }

        if !manifest.entry_path.exists() {
            return Err(format!(
                "plugin entry not found: {}",
                manifest.entry_path.display()
            ));
        }

        let mut child = Command::new("node")
            .arg(&manifest.entry_path)
            .current_dir(&manifest.plugin_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("failed to spawn plugin process: {}", error))?;

        let stdin = child.stdin.take().ok_or("plugin stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("plugin stdout unavailable")?;
        let stderr = child.stderr.take().ok_or("plugin stderr unavailable")?;
        let stdin = Arc::new(Mutex::new(stdin));

        write_handshake(
            &stdin,
            PluginHostHandshake::Initialize {
                channel_kind: manifest.channel_kind.clone(),
                host_version: env!("CARGO_PKG_VERSION").to_string(),
                config: manifest.raw_config.clone(),
            },
        )
        .await?;

        let channel_kind = manifest.channel_kind.clone();
        let stderr_channel = channel_kind.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[{}][plugin] {}", stderr_channel, line);
            }
        });

        let stdout_channel = channel_kind.clone();
        let task = tokio::spawn(async move {
            let _child = child;
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                match serde_json::from_str::<ChannelInput>(line) {
                    Ok(input) => {
                        if let Err(error) = input_tx.send(input) {
                            eprintln!(
                                "[{}] failed to forward plugin input: {}",
                                stdout_channel, error
                            );
                            break;
                        }
                    }
                    Err(error) => {
                        eprintln!(
                            "[{}] invalid plugin input JSON: {} — {}",
                            stdout_channel,
                            error,
                            &line[..line.len().min(160)]
                        );
                    }
                }
            }

            eprintln!("[{}] stdio plugin runtime exited", stdout_channel);
        });
        let abort_handle = task.abort_handle();

        Ok(Self {
            channel_kind,
            stdin,
            abort_handle,
        })
    }

    pub fn abort_handle(&self) -> AbortHandle {
        self.abort_handle.clone()
    }

    pub async fn send_output(&self, output: ChannelOutput) {
        let payload = serde_json::to_string(&output);
        let Ok(payload) = payload else {
            eprintln!("[{}] failed to encode channel output", self.channel_kind);
            return;
        };

        let mut guard = self.stdin.lock().await;
        if let Err(error) = guard.write_all(payload.as_bytes()).await {
            eprintln!("[{}] failed to write plugin output: {}", self.channel_kind, error);
            return;
        }
        if let Err(error) = guard.write_all(b"\n").await {
            eprintln!("[{}] failed to terminate plugin output: {}", self.channel_kind, error);
            return;
        }
        if let Err(error) = guard.flush().await {
            eprintln!("[{}] failed to flush plugin output: {}", self.channel_kind, error);
        }
    }

    pub async fn shutdown(&self) {
        self.abort_handle.abort();
    }
}

async fn write_handshake(
    stdin: &Arc<Mutex<tokio::process::ChildStdin>>,
    handshake: PluginHostHandshake,
) -> Result<(), String> {
    let payload = serde_json::to_string(&handshake)
        .map_err(|error| format!("failed to encode plugin handshake: {}", error))?;
    let mut guard = stdin.lock().await;
    guard
        .write_all(payload.as_bytes())
        .await
        .map_err(|error| format!("failed to write plugin handshake: {}", error))?;
    guard
        .write_all(b"\n")
        .await
        .map_err(|error| format!("failed to terminate plugin handshake: {}", error))?;
    guard
        .flush()
        .await
        .map_err(|error| format!("failed to flush plugin handshake: {}", error))?;
    Ok(())
}

#[allow(dead_code)]
async fn request_response<T>(
    _request_tx: &mpsc::Sender<T>,
    _request: T,
    _response_rx: oneshot::Receiver<Result<serde_json::Value, String>>,
) -> Result<serde_json::Value, String> {
    Err("request-response stdio RPC is not implemented".to_string())
}
