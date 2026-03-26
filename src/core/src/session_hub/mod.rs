//! SessionHub: ACP Agent surface with route state + prompt queueing.
//!
//! Implements `acp::Agent` so that upstream callers (ChannelManager, ws_chat)
//! can use standard ACP methods. Internally delegates to `AcpBridge` instances
//! obtained from `AgentManager`. Only the prompt path has queueing logic;
//! everything else is passthrough.

use std::sync::Arc;

use dashmap::DashMap;

use agent_client_protocol as acp;

use crate::acp::routing::RouteKey;
use crate::agent_manager::runtime::{AcpBridge, BridgeClientHandler};
use crate::agent_manager::AgentManager;
use crate::config;

pub mod command;
pub mod routing;
pub mod state;
pub mod types;

use self::state::{QueuedPrompt, RouteState};

pub struct SessionHub {
    agent_manager: Arc<AgentManager>,
    routes: DashMap<RouteKey, Arc<RouteState>>,
}

impl SessionHub {
    pub fn new(agent_manager: Arc<AgentManager>) -> Self {
        Self {
            agent_manager,
            routes: DashMap::new(),
        }
    }

    pub async fn shutdown_all(&self) {
        self.agent_manager.shutdown_all().await;
        self.routes.clear();
    }

    pub fn route_state(&self, route: &RouteKey) -> Option<Arc<RouteState>> {
        self.routes.get(route).map(|entry| Arc::clone(&entry))
    }

    fn get_or_create_route(&self, route: RouteKey) -> Arc<RouteState> {
        self.routes
            .entry(route.clone())
            .or_insert_with(|| Arc::new(RouteState::new(route)))
            .clone()
    }

    /// Ensure a bridge exists for the given route, creating one if needed.
    /// The `northbound_handler` receives southbound ACP events (session_notification, request_permission).
    /// Returns `(bridge, initialize_response_if_new_or_cached)`.
    pub async fn ensure_bridge(
        &self,
        route: RouteKey,
        cli_kind: Option<String>,
        resume_session_id: Option<String>,
        northbound_handler: Arc<dyn BridgeClientHandler>,
    ) -> Result<(Arc<AcpBridge>, acp::InitializeResponse), String> {
        let route_state = self.get_or_create_route(route.clone());
        let cli_kind = cli_kind.unwrap_or_else(|| config::ensure_loaded().default_agent.clone());
        let profile = route_state
            .runtime
            .lock()
            .await
            .profile
            .clone()
            .unwrap_or_else(|| "default".to_string());

        {
            let runtime = route_state.runtime.lock().await;
            if let Some(existing) = runtime.bridge.clone() {
                eprintln!("[SessionHub] ensure_bridge reusing existing bridge route={}", route);
                let initialize = runtime
                    .initialize
                    .clone()
                    .ok_or_else(|| "missing initialize response on cached bridge".to_string())?;
                return Ok((existing, initialize));
            }
        }

        eprintln!("[SessionHub] ensure_bridge creating new bridge route={} cli_kind={}", route, cli_kind);

        let ready = self
            .agent_manager
            .get_or_create_bridge(
                &route.channel_kind,
                &route.chat_id,
                &profile,
                &cli_kind,
                resume_session_id,
                northbound_handler,
            )
            .await?;

        let mut runtime = route_state.runtime.lock().await;
        runtime.bridge = Some(Arc::clone(&ready.bridge));
        runtime.cli_kind = Some(cli_kind);
        runtime.initialize = Some(ready.initialize.clone());
        if let Some(sid) = ready.startup_session_id {
            runtime.cli_session_id = Some(sid);
        }
        Ok((ready.bridge, ready.initialize))
    }

    pub async fn prompt_on_route(
        &self,
        route: RouteKey,
        cli_kind: Option<String>,
        text: String,
        northbound_handler: Arc<dyn BridgeClientHandler>,
    ) -> acp::Result<acp::PromptResponse> {
        self.prompt_on_route_with_initialize(route, cli_kind, text, northbound_handler)
            .await
            .map(|(resp, _initialize)| resp)
    }

    /// Run a prompt with per-route queueing and return the initialize response for the bridge.
    pub async fn prompt_on_route_with_initialize(
        &self,
        route: RouteKey,
        cli_kind: Option<String>,
        text: String,
        northbound_handler: Arc<dyn BridgeClientHandler>,
    ) -> acp::Result<(acp::PromptResponse, acp::InitializeResponse)> {
        let route_state = self.get_or_create_route(route.clone());

        // Acquire turn slot or queue
        let wait_turn = {
            let mut in_flight = route_state.in_flight.lock().await;
            if !*in_flight {
                *in_flight = true;
                None
            } else {
                let queued = Arc::new(QueuedPrompt::new());
                route_state.pending.lock().await.push_back(Arc::clone(&queued));
                Some(queued)
            }
        };

        if let Some(queued) = wait_turn {
            queued.notify.notified().await;
        }

        let (bridge, initialize) = self
            .ensure_bridge(route.clone(), cli_kind, None, northbound_handler)
            .await
            .map_err(|e| {
                eprintln!("[SessionHub] prompt_on_route ensure_bridge failed route={}: {}", route, e);
                acp::Error::internal_error()
            })?;
        eprintln!(
            "[SessionHub] prompt_on_route initialize route={} agent_info={:?}",
            route, initialize.agent_info
        );

        // Ensure a session exists on the bridge
        let session_id = {
            let runtime = route_state.runtime.lock().await;
            runtime.session_id.clone()
        };
        let session_id = match session_id {
            Some(sid) => {
                eprintln!("[SessionHub] prompt_on_route reusing session={} route={}", sid, route);
                sid
            }
            None => {
                let workspace = crate::config::data_dir().join("workspaces");
                eprintln!("[SessionHub] prompt_on_route creating new_session route={}", route);
                let resp = acp::Agent::new_session(&*bridge, acp::NewSessionRequest::new(workspace))
                    .await?;
                let sid = resp.session_id.to_string();
                eprintln!("[SessionHub] prompt_on_route new_session OK session={} route={}", sid, route);
                route_state.runtime.lock().await.session_id = Some(sid.clone());
                sid
            }
        };

        eprintln!("[SessionHub] prompt_on_route sending prompt session={} route={}", session_id, route);
        let request = acp::PromptRequest::new(
            session_id,
            vec![acp::ContentBlock::Text(acp::TextContent::new(text))],
        );
        let result = acp::Agent::prompt(&*bridge, request).await;
        eprintln!("[SessionHub] prompt_on_route result={:?} route={}", result.is_ok(), route);

        // Advance queue
        let next = route_state.pending.lock().await.pop_front();
        if let Some(next) = next {
            next.notify.notify_one();
        } else {
            *route_state.in_flight.lock().await = false;
        }

        result.map(|resp| (resp, initialize))
    }

    /// Cancel the active turn on a route.
    pub async fn cancel_on_route(
        &self,
        route: &RouteKey,
        args: acp::CancelNotification,
    ) -> acp::Result<()> {
        let route_state = self
            .routes
            .get(route)
            .map(|e| Arc::clone(&e))
            .ok_or_else(acp::Error::method_not_found)?;
        let runtime = route_state.runtime.lock().await;
        let bridge = runtime.bridge.clone().ok_or_else(acp::Error::method_not_found)?;
        drop(runtime);
        acp::Agent::cancel(&*bridge, args).await
    }

    /// Kill all bridges for a chat (e.g. when ws disconnects).
    pub async fn kill_route(&self, route: &RouteKey) {
        self.agent_manager
            .kill_chat_bridges(&route.channel_kind, &route.chat_id)
            .await;
        self.routes.remove(route);
    }
}
