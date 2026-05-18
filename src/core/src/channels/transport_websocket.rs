use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::RwLock;
use tokio::sync::mpsc;

use crate::routing::ChannelKind;

use super::ChannelOutput;

/// Outbound sink to a single web chat connection.
pub type WebChatSink = mpsc::UnboundedSender<ChannelOutput>;

const MAX_ROUTE_HISTORY: usize = 4000;
const SESSION_KEY_SEPARATOR: char = '\u{1f}';

/// Internal websocket-backed channel manager used by the browser chat UI.
pub struct WebChannelManager {
    connections: RwLock<HashMap<String, HashMap<String, WebChatSink>>>,
    route_agents: RwLock<HashMap<String, String>>,
    route_sessions: RwLock<HashMap<String, String>>,
    session_routes: RwLock<HashMap<String, String>>,
    route_history: RwLock<HashMap<String, Vec<ChannelOutput>>>,
}

impl WebChannelManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            connections: RwLock::new(HashMap::new()),
            route_agents: RwLock::new(HashMap::new()),
            route_sessions: RwLock::new(HashMap::new()),
            session_routes: RwLock::new(HashMap::new()),
            route_history: RwLock::new(HashMap::new()),
        })
    }

    pub fn register_connection(
        &self,
        route_chat_id: String,
        connection_id: String,
        sink: WebChatSink,
        replay_history: bool,
    ) {
        self.connections
            .write()
            .entry(route_chat_id.clone())
            .or_default()
            .insert(connection_id, sink.clone());

        if replay_history {
            let history = self
                .route_history
                .read()
                .get(&route_chat_id)
                .cloned()
                .unwrap_or_default();
            for output in history {
                let _ = sink.send(output);
            }
        }
    }

    pub fn unregister_connection(&self, route_chat_id: &str, connection_id: &str) {
        let mut connections = self.connections.write();
        let Some(route_connections) = connections.get_mut(route_chat_id) else {
            return;
        };
        route_connections.remove(connection_id);
        if route_connections.is_empty() {
            connections.remove(route_chat_id);
        }
    }

    pub fn set_route_agent(&self, route_chat_id: &str, agent_id: String) {
        self.route_agents
            .write()
            .insert(route_chat_id.to_string(), agent_id);
    }

    pub fn route_for_session(&self, agent_id: &str, session_id: &str) -> Option<String> {
        self.session_routes
            .read()
            .get(&session_key(agent_id, session_id))
            .cloned()
    }

    pub fn route_has_session(&self, route_chat_id: &str) -> bool {
        self.route_sessions.read().contains_key(route_chat_id)
    }

    pub fn sender(
        &self,
    ) -> (
        mpsc::UnboundedSender<ChannelOutput>,
        mpsc::UnboundedReceiver<ChannelOutput>,
    ) {
        mpsc::unbounded_channel()
    }

    pub fn dispatch_output(&self, output: ChannelOutput) {
        let chat_id = output.route_key().chat_id.clone();
        if let ChannelOutput::SessionReady { session_id, .. } = &output {
            self.bind_route_session(&chat_id, session_id);
        }
        self.push_route_history(&chat_id, output.clone());

        let sinks = self
            .connections
            .read()
            .get(&chat_id)
            .map(|connections| connections.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        tracing::info!(
            "[WebChannelManager] dispatch_output chat_id={} subscribers={}",
            chat_id,
            sinks.len()
        );
        for sink in sinks {
            let _ = sink.send(output.clone());
        }
    }

    fn bind_route_session(&self, route_chat_id: &str, session_id: &str) {
        let Some(agent_id) = self.route_agents.read().get(route_chat_id).cloned() else {
            return;
        };
        let key = session_key(&agent_id, session_id);
        self.route_sessions
            .write()
            .insert(route_chat_id.to_string(), key.clone());
        self.session_routes
            .write()
            .insert(key, route_chat_id.to_string());
    }

    fn push_route_history(&self, route_chat_id: &str, output: ChannelOutput) {
        if matches!(output, ChannelOutput::PermissionRequest { .. }) {
            return;
        }
        let mut history = self.route_history.write();
        let items = history.entry(route_chat_id.to_string()).or_default();
        items.push(output);
        if items.len() > MAX_ROUTE_HISTORY {
            let overflow = items.len() - MAX_ROUTE_HISTORY;
            items.drain(0..overflow);
        }
    }
}

fn session_key(agent_id: &str, session_id: &str) -> String {
    format!("{agent_id}{SESSION_KEY_SEPARATOR}{session_id}")
}

#[derive(Debug)]
pub struct WebSocketPluginRuntime {
    channel_kind: ChannelKind,
    outbound_tx: mpsc::UnboundedSender<ChannelOutput>,
}

impl WebSocketPluginRuntime {
    pub fn new(
        channel_kind: impl Into<ChannelKind>,
        outbound_tx: mpsc::UnboundedSender<ChannelOutput>,
    ) -> Arc<Self> {
        Arc::new(Self {
            channel_kind: channel_kind.into(),
            outbound_tx,
        })
    }

    pub async fn send_output(&self, output: ChannelOutput) {
        tracing::info!(
            "[WebSocketPluginRuntime] send_output channel_kind={} route={}",
            self.channel_kind,
            output.route_key()
        );
        if let Err(error) = self.outbound_tx.send(output) {
            tracing::info!(
                "[{}] failed to deliver websocket output: {}",
                self.channel_kind,
                error
            );
        }
    }

    pub async fn shutdown(&self) {}
}
