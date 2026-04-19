//! `ACPPod` internal bridge + session lifecycle.
//!
//! These methods manage the spawned ACP bridge process on behalf of the
//! public API in `pod/mod.rs`. They're split into their own `impl`
//! block so the public-facing methods (prompt, cancel, close, etc.)
//! stay close together and this file owns all the "spawn a bridge,
//! keep it alive, wire notifications" plumbing.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use anyhow::anyhow;

use agent_client_protocol as acp;

use crate::agent_factory::runtime::{AcpBridge, BridgeClientHandler};
use crate::config;

use super::super::event::SystemEvent;
use super::bridge_handler::SessionBridgeHandler;
use super::ACPPod;

impl ACPPod {
    /// Ensure a bridge exists, spawning one via agent_factory if needed.
    pub(super) async fn ensure_bridge(
        self: &Arc<Self>,
        cli_kind: Option<String>,
        resume_session_id: Option<String>,
        resume_cwd: Option<String>,
        downstream_handler: Arc<dyn BridgeClientHandler>,
    ) -> anyhow::Result<Arc<AcpBridge>> {
        let stored_cli_kind = self.cli_kind.lock().await.clone();
        let resolved_cli_kind = stored_cli_kind
            .clone()
            .or(cli_kind.clone())
            .unwrap_or_else(|| config::ensure_loaded().default_agent.clone());

        // If bridge exists, check if caller requested a different agent (implicit switch).
        if let Some(existing) = self.bridge.lock().await.clone() {
            let needs_switch = cli_kind
                .as_ref()
                .map(|requested| {
                    stored_cli_kind
                        .as_ref()
                        .map(|stored| stored != requested)
                        .unwrap_or(false)
                })
                .unwrap_or(false);

            if needs_switch {
                let new_kind = cli_kind.unwrap();
                tracing::info!(
                    route = %self.route,
                    from = %resolved_cli_kind,
                    to = %new_kind,
                    "implicit agent switch on prompt"
                );
                self.full_reset().await;
                *self.cli_kind.lock().await = Some(new_kind.clone());
            } else {
                tracing::debug!(route = %self.route, "reusing existing bridge");
                return Ok(existing);
            }
        }

        let cli_kind = self
            .cli_kind
            .lock()
            .await
            .clone()
            .unwrap_or_else(|| config::ensure_loaded().default_agent.clone());
        tracing::info!(route = %self.route, cli_kind = %cli_kind, "spawning new bridge");
        let profile = self
            .profile
            .lock()
            .await
            .clone()
            .unwrap_or_else(|| "default".to_string());

        // Resolve workspace — handover must include cwd, normal prompt uses default.
        let is_handover = resume_session_id.is_some();
        let workspace = match resume_cwd {
            Some(cwd) => std::path::PathBuf::from(cwd),
            None if is_handover => {
                return Err(anyhow!(
                    "Session pickup is missing the working directory. \
                     Please re-run the handover to get an updated /pickup command that includes the cwd."
                ));
            }
            None => config::ensure_loaded().resolve_workspace(&cli_kind),
        };

        // Track workspace for snapshot (used by /handover Direction 2).
        *self.workspace.lock().await = Some(workspace.to_string_lossy().to_string());

        // Wrap downstream handler — suppress replay during handover load_session.
        let is_handover = resume_session_id.is_some();
        let suppress_replay = Arc::new(AtomicBool::new(is_handover));
        let handler: Arc<dyn BridgeClientHandler> = Arc::new(SessionBridgeHandler {
            downstream: downstream_handler,
            suppress_replay: Arc::clone(&suppress_replay),
        });

        let ready = match crate::agent_factory::spawn_bridge(
            &self.route.channel_kind,
            &self.route.chat_id,
            &cli_kind,
            &workspace,
            resume_session_id.clone(),
            handler,
        )
        .await
        {
            Ok(ready) => ready,
            Err(error) => {
                let msg = error.to_string();
                *self.failed.lock().await = Some(msg.clone());
                self.emit(SystemEvent::AgentInitializeFailed {
                    route: self.route.clone(),
                    cli_kind: Some(cli_kind),
                    error: msg,
                });
                let _ = self.change_tx.send(());
                return Err(error);
            }
        };

        // Store suppress_replay on the pod — released before the first prompt,
        // not here, because some agents (Gemini) continue replaying after load_session.
        if is_handover {
            *self.suppress_replay.lock().await = Some(suppress_replay);
        }

        tracing::debug!(
            route = %self.route,
            cli_kind = %cli_kind,
            agent_info = ?ready.initialize.agent_info,
            "bridge ready"
        );
        *self.bridge.lock().await = Some(Arc::clone(&ready.bridge));
        *self.cli_kind.lock().await = Some(cli_kind.clone());
        *self.profile.lock().await = Some(profile.clone());
        *self.initialize.lock().await = Some(ready.initialize.clone());
        *self.failed.lock().await = None;

        if let Some(session_id) = resume_session_id.or(ready.startup_session_id) {
            *self.session_id.lock().await = Some(session_id.clone());
            self.emit(SystemEvent::SessionReady {
                route: self.route.clone(),
                session_id,
            });
        }

        self.spawn_provider_session_watcher(&ready.bridge).await;
        self.emit(SystemEvent::AgentInitialized {
            route: self.route.clone(),
            cli_kind: Some(cli_kind),
            profile: Some(profile),
            initialize: ready.initialize.clone(),
        });
        let _ = self.change_tx.send(());

        Ok(ready.bridge)
    }

    /// Ensure a session exists, creating one if needed.
    pub(super) async fn ensure_session(&self, bridge: &Arc<AcpBridge>) -> acp::Result<String> {
        if let Some(session_id) = self.session_id.lock().await.clone() {
            return Ok(session_id);
        }

        let agent_kind = self
            .cli_kind
            .lock()
            .await
            .clone()
            .unwrap_or_else(|| "claude".to_string());
        let workspace = config::ensure_loaded().resolve_workspace(&agent_kind);
        let response =
            acp::Agent::new_session(&**bridge, acp::NewSessionRequest::new(workspace)).await?;
        let session_id = response.session_id.to_string();
        *self.session_id.lock().await = Some(session_id.clone());

        self.emit(SystemEvent::SessionReady {
            route: self.route.clone(),
            session_id: session_id.clone(),
        });
        let _ = self.change_tx.send(());

        Ok(session_id)
    }

    /// Kill bridge and clear all state.
    ///
    /// Does not wait for any in-flight prompt — the bridge shutdown signal
    /// is sent immediately. Any concurrent `acp::Agent::prompt` future will
    /// receive an ACP error. Subsequent prompts will re-spawn a fresh
    /// bridge via `ensure_bridge`.
    pub(super) async fn full_reset(&self) {
        if let Some(bridge) = self.bridge.lock().await.take() {
            bridge.shutdown().await;
            tracing::info!(route = %self.route, "bridge killed (full_reset)");
        }
        *self.session_id.lock().await = None;
        *self.initialize.lock().await = None;
        *self.failed.lock().await = None;
        *self.busy.lock().await = false;
        *self.handover_resume_session_id.lock().await = None;
        *self.handover_cwd.lock().await = None;
        *self.suppress_replay.lock().await = None;
        tracing::debug!(route = %self.route, "full_reset complete");
    }

    pub(super) async fn spawn_provider_session_watcher(
        self: &Arc<Self>,
        bridge: &Arc<AcpBridge>,
    ) {
        let Some(mut rx) = bridge.take_provider_session_id_rx().await else {
            return;
        };
        let pod = Arc::downgrade(self);
        tokio::spawn(async move {
            while let Some(session_id) = rx.recv().await {
                let Some(pod) = pod.upgrade() else {
                    break;
                };
                *pod.session_id.lock().await = Some(session_id);
                let _ = pod.change_tx.send(());
            }
        });
    }
}

