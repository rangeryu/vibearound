//! ACP-native channel manager: hosts channel plugins and routes traffic.
//!
//! The web channel path uses ACP directly (ws_chat calls SessionHub methods).
//! Stdio plugins still use the legacy ChannelInput/ChannelOutput for now.

pub mod manifest;
pub mod plugin_host;
pub mod plugin_runtime;
pub mod transport_stdio;
pub mod transport_websocket;

use std::sync::{Arc, Mutex as StdMutex};

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio::task::AbortHandle;

use crate::acp::routing::{Attachment, MessageId, RouteEnvelope, RouteKey, TurnId};
use crate::agent_manager::runtime::BridgeClientHandler;
use crate::plugins::DiscoveredPlugin;
use crate::session_hub::SessionHub;

use agent_client_protocol as acp;

use self::manifest::ChannelPluginManifest;
use self::plugin_host::PluginHost;

pub use self::transport_websocket::WebChannelManager;

/// Legacy envelope kept for stdio plugin compatibility.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEnvelope {
    pub route: RouteKey,
    #[serde(default)]
    pub message_id: MessageId,
    #[serde(default)]
    pub turn_id: Option<TurnId>,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub sender_id: String,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub cli_kind: Option<String>,
}

impl ChannelEnvelope {
    pub fn into_route_envelope(self) -> RouteEnvelope {
        RouteEnvelope {
            channel_kind: self.route.channel_kind,
            chat_id: self.route.chat_id,
            message_id: self.message_id,
            turn_id: self.turn_id,
            text: self.text,
            sender_id: self.sender_id,
            attachments: self.attachments,
            parent_id: self.parent_id,
            cli_kind: self.cli_kind,
        }
    }
}

/// Legacy stdio plugin input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ChannelInput {
    Message {
        #[serde(flatten)]
        envelope: ChannelEnvelope,
    },
    Callback {
        #[serde(flatten)]
        envelope: ChannelEnvelope,
        #[serde(default)]
        action_value: Option<String>,
    },
    Stop {
        route: RouteKey,
    },
    Close {
        route: RouteKey,
        #[serde(default)]
        reason: Option<String>,
    },
    SwitchAgent {
        route: RouteKey,
        agent_kind: String,
    },
    Log {
        #[serde(default)]
        level: Option<String>,
        message: String,
    },
}

/// Legacy stdio plugin output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ChannelOutput {
    RawAcp {
        route: RouteKey,
        payload: serde_json::Value,
    },
    SystemText {
        route: RouteKey,
        text: String,
        reply_to: Option<MessageId>,
    },
}

impl ChannelOutput {
    pub fn route_key(&self) -> &RouteKey {
        match self {
            Self::RawAcp { route, .. } | Self::SystemText { route, .. } => route,
        }
    }
}

pub struct ChannelManager {
    plugin_host: Arc<PluginHost>,
    /// Channel for fire-and-forget input dispatch.
    /// `handle_input` sends here; the processing loop runs on a dedicated
    /// `spawn_local` task so that `!Send` ACP futures are allowed.
    input_tx: mpsc::UnboundedSender<ChannelInput>,
    input_rx: StdMutex<Option<mpsc::UnboundedReceiver<ChannelInput>>>,
    session_hub: Arc<SessionHub>,
}

impl ChannelManager {
    pub fn new(session_hub: Arc<SessionHub>) -> Self {
        let (input_tx, input_rx) = mpsc::unbounded_channel();
        Self {
            plugin_host: Arc::new(PluginHost::new(input_tx.clone())),
            input_tx,
            input_rx: StdMutex::new(Some(input_rx)),
            session_hub,
        }
    }

    pub fn plugin_host(&self) -> Arc<PluginHost> {
        Arc::clone(&self.plugin_host)
    }

    /// Take the input receiver so the caller can drive the processing loop.
    /// This must be called exactly once (typically during daemon startup).
    pub fn take_input_rx(&self) -> Option<mpsc::UnboundedReceiver<ChannelInput>> {
        self.input_rx.lock().unwrap().take()
    }

    pub async fn start_plugin(
        &self,
        channel_name: &str,
        plugin: &DiscoveredPlugin,
    ) -> Option<AbortHandle> {
        let manifest = match ChannelPluginManifest::from_discovered(channel_name.to_string(), plugin) {
            Some(manifest) => manifest,
            None => {
                eprintln!(
                    "[{}] config=missing channels.{} — plugin disabled",
                    channel_name, channel_name
                );
                return None;
            }
        };

        match self.plugin_host.register_stdio_plugin(manifest).await {
            Ok(abort_handle) => Some(abort_handle),
            Err(error) => {
                eprintln!("[{}] failed to start plugin: {}", channel_name, error);
                None
            }
        }
    }

    pub fn start_internal_plugin(
        &self,
        channel_name: &str,
        outbound_tx: mpsc::UnboundedSender<ChannelOutput>,
    ) {
        self.plugin_host
            .register_websocket_plugin(channel_name.to_string(), outbound_tx);
        eprintln!("[{}] registered internal ACP plugin", channel_name);
    }

    /// Fire-and-forget: enqueue input for async processing.
    /// This is `Send`-safe because it only does a channel send.
    pub fn handle_input(&self, input: ChannelInput) {
        let _ = self.input_tx.send(input);
    }

    /// Process a single input on the current executor.
    /// This may await `!Send` ACP futures, so callers should run it on a
    /// `LocalSet` or other non-`Send`-compatible context when needed.
    pub async fn process_input(&self, input: ChannelInput) {
        handle_channel_input(&self.session_hub, &self.plugin_host, input).await;
    }

    pub fn session_hub_ref(&self) -> Arc<SessionHub> {
        Arc::clone(&self.session_hub)
    }

    pub async fn send_output(&self, output: ChannelOutput) {
        self.plugin_host.send_output(output).await;
    }

    pub async fn shutdown_all(&self) {
        self.plugin_host.shutdown_all().await;
    }
}

pub async fn handle_channel_input(
    session_hub: &Arc<SessionHub>,
    plugin_host: &Arc<PluginHost>,
    input: ChannelInput,
) {
    match input {
        ChannelInput::Message { envelope } => {
            let route_envelope = envelope.into_route_envelope();
            let route = route_envelope.route_key();
            let text = route_envelope.text.clone();
            let cli_kind = route_envelope.cli_kind.clone();
            eprintln!(
                "[ChannelManager] handle_channel_input Message route={} cli_kind={:?} text_len={}",
                route, cli_kind, text.len()
            );
            let handler: Arc<dyn BridgeClientHandler> = Arc::new(ChannelBridgeHandler {
                plugin_host: Arc::clone(plugin_host),
                route: route.clone(),
            });
            match session_hub
                .prompt_on_route(route.clone(), cli_kind, text, handler)
                .await
            {
                Ok(_resp) => eprintln!(
                    "[ChannelManager] prompt_on_route OK route={}",
                    route
                ),
                Err(e) => eprintln!(
                    "[ChannelManager] prompt_on_route ERR route={} error={}",
                    route, e
                ),
            }
        }
        ChannelInput::Callback {
            envelope,
            action_value,
        } => {
            let mut route_envelope = envelope.into_route_envelope();
            if route_envelope.text.is_empty() {
                route_envelope.text = action_value
                    .map(|value| format!("[button:{}]", value))
                    .unwrap_or_else(|| "[button]".to_string());
            }
            let route = route_envelope.route_key();
            let text = route_envelope.text.clone();
            let cli_kind = route_envelope.cli_kind.clone();
            let handler: Arc<dyn BridgeClientHandler> = Arc::new(ChannelBridgeHandler {
                plugin_host: Arc::clone(plugin_host),
                route: route.clone(),
            });
            let _ = session_hub
                .prompt_on_route(route, cli_kind, text, handler)
                .await;
        }
        ChannelInput::Stop { route } => {
            if let Some(route_state) = session_hub.route_state(&route) {
                if let Some(session_id) = route_state.runtime.lock().await.session_id.clone() {
                    let _ = session_hub
                        .cancel_on_route(&route, acp::CancelNotification::new(session_id))
                        .await;
                }
            }
        }
        ChannelInput::Close { route, reason: _ } => {
            session_hub.kill_route(&route).await;
        }
        ChannelInput::SwitchAgent { route, agent_kind } => {
            if let Some(route_state) = session_hub.route_state(&route) {
                route_state.runtime.lock().await.cli_kind = Some(agent_kind);
            }
        }
        ChannelInput::Log { level, message } => {
            eprintln!(
                "[ChannelManager][channel][{}] {}",
                level.unwrap_or_else(|| "info".to_string()),
                message
            );
        }
    }
}

struct ChannelBridgeHandler {
    plugin_host: Arc<PluginHost>,
    route: RouteKey,
}

#[async_trait::async_trait(?Send)]
impl BridgeClientHandler for ChannelBridgeHandler {
    async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
        eprintln!(
            "[ChannelBridgeHandler] session_notification route={} session={}",
            self.route, args.session_id
        );
        let payload = serde_json::to_value(&args)
            .map_err(|e| acp::Error::new(-32603, format!("serialize: {}", e)))?;
        self.plugin_host
            .send_output(ChannelOutput::RawAcp {
                route: self.route.clone(),
                payload,
            })
            .await;
        Ok(())
    }

    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        if let Some(first) = args.options.first() {
            Ok(acp::RequestPermissionResponse::new(
                acp::RequestPermissionOutcome::Selected(
                    acp::SelectedPermissionOutcome::new(first.option_id.clone()),
                ),
            ))
        } else {
            Err(acp::Error::method_not_found())
        }
    }
}
