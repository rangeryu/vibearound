//! `Conversation` internal agent + session lifecycle.
//!
//! These methods manage the spawned [`Agent`] on behalf of the public
//! API in `conversation/mod.rs`. They live in their own `impl` block so
//! the public-facing methods (prompt, cancel, close, etc.) stay close
//! together and this file owns all the "spawn an agent, keep it alive,
//! wire notifications" plumbing.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context};

use agent_client_protocol::schema as acp;

use crate::agent::{Agent, AgentClientHandler};
use crate::agent_state;
use crate::config;
use crate::profiles;

use super::super::event::SystemEvent;
use super::super::handover::HandoverHandler;
use super::super::session_log::{
    append_im_session_started, is_im_route, ImSessionStartRecord, SessionStartSource,
};
use super::Conversation;

impl Conversation {
    /// Ensure a live [`Agent`] exists, spawning one if needed. Reuses the
    /// existing Agent if the caller didn't request a different `cli_kind`.
    pub(super) async fn ensure_agent(
        self: &Arc<Self>,
        cli_kind: Option<String>,
        resume_session_id: Option<String>,
        resume_cwd: Option<String>,
        downstream_handler: Arc<dyn AgentClientHandler>,
    ) -> anyhow::Result<Arc<Agent>> {
        let requested_cli_kind = cli_kind
            .as_deref()
            .map(crate::resources::resolve_agent_id)
            .transpose()
            .map_err(anyhow::Error::msg)?;
        let cfg = config::ensure_loaded();
        let agent_prefs = agent_state::read_prefs();
        let default_agent = agent_state::resolve_default_agent(&agent_prefs, &cfg);
        let stored_cli_kind = self.cli_kind.lock().await.clone();
        let resolved_cli_kind = stored_cli_kind
            .clone()
            .or(requested_cli_kind.clone())
            .unwrap_or_else(|| default_agent.clone());

        // If an Agent exists, check if caller requested a different kind (implicit switch).
        if let Some(existing) = self.agent.lock().await.clone() {
            let needs_switch = requested_cli_kind
                .as_ref()
                .map(|requested| {
                    stored_cli_kind
                        .as_ref()
                        .map(|stored| stored != requested)
                        .unwrap_or(false)
                })
                .unwrap_or(false);

            if needs_switch {
                let new_kind = requested_cli_kind.clone().unwrap();
                tracing::info!(
                    route = %self.route,
                    from = %resolved_cli_kind,
                    to = %new_kind,
                    "implicit agent switch on prompt"
                );
                self.full_reset().await;
                *self.cli_kind.lock().await = Some(new_kind.clone());
                *self.profile.lock().await = None;
            } else {
                tracing::debug!(route = %self.route, "reusing existing agent");
                return Ok(existing);
            }
        }

        let stored_cli_kind = self.cli_kind.lock().await.clone();
        let cli_kind = match (stored_cli_kind.clone(), requested_cli_kind.clone()) {
            (Some(stored), Some(requested)) if stored != requested => {
                *self.profile.lock().await = None;
                requested
            }
            (Some(stored), _) => stored,
            (None, Some(requested)) => requested,
            (None, None) => default_agent,
        };
        let agent_id = crate::resources::resolve_agent_id(&cli_kind).map_err(anyhow::Error::msg)?;
        let cli_kind = agent_id.clone();
        tracing::info!(route = %self.route, cli_kind = %cli_kind, "spawning new agent");
        let profile = self
            .profile
            .lock()
            .await
            .clone()
            .or_else(|| agent_state::resolve_default_profile(&agent_prefs, &cfg, &cli_kind))
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
            None => self
                .workspace
                .lock()
                .await
                .clone()
                .map(PathBuf::from)
                .unwrap_or_else(|| config::ensure_loaded().resolve_workspace(&cli_kind)),
        };

        // Track workspace for snapshot (used by /handover Direction 2).
        *self.workspace.lock().await = Some(workspace.to_string_lossy().to_string());

        // Wrap downstream handler — suppress replay during handover load_session.
        let suppress_replay = Arc::new(AtomicBool::new(is_handover));
        let handler: Arc<dyn AgentClientHandler> = Arc::new(HandoverHandler {
            downstream: downstream_handler,
            suppress_replay: Arc::clone(&suppress_replay),
        });

        // Resolve concrete agent_id from alias ("claude" etc. → canonical id)
        // and ensure the workspace exists. Env vars are injected so skills
        // can resolve which conversation they belong to.
        std::fs::create_dir_all(&workspace)
            .with_context(|| format!("Failed to create workspace {:?}", &workspace))?;

        let mut env_vars = vec![
            (
                "VIBEAROUND_CHANNEL_KIND".to_string(),
                self.route.channel_kind.clone(),
            ),
            ("VIBEAROUND_CHAT_ID".to_string(), self.route.chat_id.clone()),
            ("VIBEAROUND_AGENT_KIND".to_string(), agent_id.clone()),
        ];
        let mut extra_args = Vec::new();
        if profile_uses_vibearound_credentials(&profile) {
            let applied =
                materialize_profile_for_agent(&profile, &agent_id, &workspace, &self.route)
                    .with_context(|| {
                        format!(
                            "failed to apply profile '{}' to agent '{}'",
                            profile, agent_id
                        )
                    })?;
            tracing::info!(
                route = %self.route,
                cli_kind = %cli_kind,
                profile = %profile,
                args = applied.command_args.len(),
                "applied profile for agent spawn"
            );
            env_vars.extend(applied.env);
            extra_args.extend(applied.command_args);
        }

        let ready = match Agent::spawn(
            agent_id,
            &self.route,
            &workspace,
            resume_session_id.clone(),
            handler,
            extra_args,
            env_vars,
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

        // Store suppress_replay — released before the first prompt, not here,
        // because some agents (Gemini) continue replaying after load_session.
        if is_handover {
            *self.suppress_replay.lock().await = Some(suppress_replay);
        }

        tracing::debug!(
            route = %self.route,
            cli_kind = %cli_kind,
            agent_info = ?ready.initialize.agent_info,
            "agent ready"
        );
        *self.agent.lock().await = Some(Arc::clone(&ready.agent));
        *self.cli_kind.lock().await = Some(cli_kind.clone());
        *self.profile.lock().await = Some(profile.clone());
        *self.initialize.lock().await = Some(ready.initialize.clone());
        *self.failed.lock().await = None;

        if let Some(session_id) = resume_session_id.or(ready.startup_session_id) {
            *self.session_id.lock().await = Some(session_id.clone());
            let source = if is_handover {
                SessionStartSource::Pickup
            } else {
                SessionStartSource::StartupSession
            };
            self.log_im_session_started_once(&session_id, source).await;
            self.emit(SystemEvent::SessionReady {
                route: self.route.clone(),
                session_id,
            });
        }

        self.emit(SystemEvent::AgentInitialized {
            route: self.route.clone(),
            cli_kind: Some(cli_kind),
            profile: Some(profile),
            initialize: ready.initialize.clone(),
        });
        let _ = self.change_tx.send(());

        Ok(ready.agent)
    }

    /// Ensure a session exists on the given agent, creating one if needed.
    pub(super) async fn ensure_session(&self, agent: &Arc<Agent>) -> acp::Result<String> {
        if let Some(session_id) = self.session_id.lock().await.clone() {
            return Ok(session_id);
        }

        let agent_kind = self
            .cli_kind
            .lock()
            .await
            .clone()
            .unwrap_or_else(|| "claude".to_string());
        let workspace = self
            .workspace
            .lock()
            .await
            .clone()
            .map(PathBuf::from)
            .unwrap_or_else(|| config::ensure_loaded().resolve_workspace(&agent_kind));
        let response = agent
            .new_session(acp::NewSessionRequest::new(workspace))
            .await?;
        let session_id = response.session_id.to_string();
        *self.session_id.lock().await = Some(session_id.clone());
        self.log_im_session_started_once(&session_id, SessionStartSource::NewSession)
            .await;

        self.emit(SystemEvent::SessionReady {
            route: self.route.clone(),
            session_id: session_id.clone(),
        });
        let _ = self.change_tx.send(());

        Ok(session_id)
    }

    /// Kill the current agent and clear runtime state while preserving the
    /// route-level agent/profile selection. Callers that change agent
    /// identity clear the profile explicitly before the next spawn.
    ///
    /// Does not wait for any in-flight prompt — the agent shutdown signal
    /// is sent immediately. Any concurrent `Agent::prompt` future will
    /// receive an ACP error. Subsequent prompts will re-spawn a fresh agent
    /// via `ensure_agent`.
    pub(super) async fn full_reset(&self) {
        if let Some(agent) = self.agent.lock().await.take() {
            agent.shutdown().await;
            tracing::info!(route = %self.route, "agent killed (full_reset)");
        }
        *self.session_id.lock().await = None;
        *self.initialize.lock().await = None;
        *self.failed.lock().await = None;
        *self.busy.lock().await = false;
        *self.workspace.lock().await = None;
        *self.logged_session_id.lock().await = None;
        *self.handover_resume_session_id.lock().await = None;
        *self.handover_cwd.lock().await = None;
        *self.suppress_replay.lock().await = None;
        tracing::debug!(route = %self.route, "full_reset complete");
    }

    async fn log_im_session_started_once(&self, session_id: &str, source: SessionStartSource) {
        if !is_im_route(&self.route) {
            return;
        }

        {
            let mut logged_session_id = self.logged_session_id.lock().await;
            if logged_session_id.as_deref() == Some(session_id) {
                return;
            }
            *logged_session_id = Some(session_id.to_string());
        }

        let state = self.state().await;
        let record = ImSessionStartRecord::new(
            self.route.clone(),
            state.cli_kind,
            state.profile,
            session_id.to_string(),
            source,
            state.workspace,
        );

        if let Err(error) = append_im_session_started(record).await {
            tracing::warn!(
                route = %self.route,
                session_id = %session_id,
                error = %error,
                "failed to append IM session startup index"
            );
        }
    }
}

fn profile_uses_vibearound_credentials(profile: &str) -> bool {
    !matches!(profile, "default" | "none" | "off" | "direct")
}

struct AppliedProfile {
    env: Vec<(String, String)>,
    command_args: Vec<String>,
}

fn materialize_profile_for_agent(
    profile_id: &str,
    agent_id: &str,
    workspace: &Path,
    channel_route: &crate::routing::RouteKey,
) -> anyhow::Result<AppliedProfile> {
    let profile = profiles::schema::load(profile_id)
        .map(profiles::normalize_legacy_profile_and_persist)
        .ok_or_else(|| anyhow!("profile '{}' not found", profile_id))?;
    let route = profiles::connections::resolve_profile_agent_route(&profile, agent_id).ok_or_else(
        || {
            anyhow!(
                "profile '{}' cannot launch agent '{}'",
                profile.id,
                agent_id
            )
        },
    )?;
    let launch_id = uuid::Uuid::new_v4().to_string();
    let rendered =
        profiles::runtime::render_for_agent_route(&profile, agent_id, &launch_id, &route)?;
    if route.proxy_target_api_type.is_some() {
        write_proxy_launch_metadata(
            &launch_id,
            &profile.id,
            agent_id,
            workspace,
            channel_route,
            &route,
        )?;
    }
    let command_args = rendered.command_args.clone();
    let mut env = profiles::runtime::materialize_env(&profile.id, rendered)?;
    env.push(("VIBEAROUND_LAUNCH_ID".to_string(), launch_id));
    env.push(("VIBEAROUND_PROFILE_ID".to_string(), profile.id.clone()));
    env.push(("VIBEAROUND_LAUNCH_TARGET".to_string(), agent_id.to_string()));

    Ok(AppliedProfile { env, command_args })
}

fn write_proxy_launch_metadata(
    launch_id: &str,
    profile_id: &str,
    agent_id: &str,
    workspace: &Path,
    channel_route: &crate::routing::RouteKey,
    route: &profiles::connections::ProfileAgentRoute,
) -> anyhow::Result<()> {
    let dir = config::data_dir().join("api-proxy").join("launches");
    std::fs::create_dir_all(&dir)?;
    let body = serde_json::json!({
        "schemaVersion": 1,
        "createdAtUnix": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default(),
        "launchId": launch_id,
        "profileId": profile_id,
        "agent": agent_id,
        "workspace": workspace.to_string_lossy(),
        "channelKind": channel_route.channel_kind,
        "chatId": channel_route.chat_id,
        "clientProtocol": route.client_api_type,
        "upstreamProtocol": route.proxy_target_api_type,
    });
    let path = dir.join(format!("{launch_id}.json"));
    std::fs::write(path, serde_json::to_vec_pretty(&body)?)?;
    Ok(())
}
