//! `ChannelBridgeHandler` — the downstream handler wired to the upstream
//! `Agent`. Its two jobs:
//!
//! 1. **`session_notification`** — wrap every `acp::SessionNotification`
//!    from the agent as a workspace-thread reply, then fan it out to attached
//!    channel routes.
//! 2. **`request_permission`** — turn an ACP `requestPermission` call from
//!    the upstream agent into a `ChannelOutput::PermissionRequest` to the
//!    plugin, then await the plugin's reply via a per-request oneshot
//!    registered in `PluginHost::pending_permissions`. No timeout — the UX
//!    is "user takes as long as they need".

use std::sync::{Arc, Weak};

use agent_client_protocol::schema as acp;

use crate::agent::AgentClientHandler;
use crate::routing::RouteKey;
use crate::workspace::registry::WorkspaceId;
use crate::workspace::threads::store::{HostBinding, WorkspaceThreadId};
use crate::workspace::WorkspaceThreadManager;

use super::plugin_host::PluginHost;
use super::types::{ChannelOutput, ThreadReply, ThreadReplyAgent, ThreadReplyPayload};

pub(crate) struct ChannelBridgeHandler {
    plugin_host: Arc<PluginHost>,
    workspace_threads: Weak<WorkspaceThreadManager>,
    workspace_id: WorkspaceId,
    thread_id: WorkspaceThreadId,
    host_binding: HostBinding,
}

impl ChannelBridgeHandler {
    pub(crate) fn for_thread(
        plugin_host: Arc<PluginHost>,
        workspace_threads: &Arc<WorkspaceThreadManager>,
        workspace_id: WorkspaceId,
        thread_id: WorkspaceThreadId,
        host_binding: HostBinding,
    ) -> Self {
        Self {
            plugin_host,
            workspace_threads: Arc::downgrade(workspace_threads),
            workspace_id,
            thread_id,
            host_binding,
        }
    }

    async fn attached_routes(&self) -> Vec<RouteKey> {
        let Some(workspace_threads) = self.workspace_threads.upgrade() else {
            return Vec::new();
        };
        match workspace_threads
            .attached_routes_for_thread(&self.thread_id)
            .await
        {
            Ok(routes) => routes,
            Err(error) => {
                tracing::warn!(
                    "[ChannelBridgeHandler] failed to resolve attached routes thread={}: {:#}",
                    self.thread_id,
                    error
                );
                Vec::new()
            }
        }
    }
}

#[async_trait::async_trait]
impl AgentClientHandler for ChannelBridgeHandler {
    async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
        let payload = serde_json::to_value(&args)
            .map_err(|e| acp::Error::new(-32603, format!("serialize: {}", e)))?;

        // Log the update variant so we can tell whether an agent is emitting
        // real assistant text or only tool/thinking chunks. Claude Agent
        // v0.25.x sometimes end-turns after only tool_call updates and never
        // yields a user-visible message; this log surfaces that case.
        let update_kind = payload
            .get("update")
            .and_then(|u| u.get("sessionUpdate"))
            .and_then(|v| v.as_str())
            .unwrap_or("<none>");
        let preview = payload
            .get("update")
            .and_then(|u| u.get("content"))
            .and_then(|c| c.get("text"))
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(60).collect::<String>())
            .unwrap_or_default();
        tracing::info!(
            "[ChannelBridgeHandler] session_notification thread={} session={} kind={} preview={:?}",
            self.thread_id,
            args.session_id,
            update_kind,
            preview
        );

        let reply = ThreadReply {
            workspace_id: self.workspace_id.to_string(),
            thread_id: self.thread_id.to_string(),
            agent: ThreadReplyAgent {
                id: self.host_binding.agent_id.clone(),
                profile: self.host_binding.profile_id.clone(),
                session_id: args.session_id.to_string(),
            },
            payload: ThreadReplyPayload::AcpSessionNotification {
                notification: payload,
            },
        };

        for route in self.attached_routes().await {
            self.plugin_host
                .send_output(ChannelOutput::ThreadReply {
                    route,
                    reply: reply.clone(),
                })
                .await;
        }
        Ok(())
    }

    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        if args.options.is_empty() {
            return Err(acp::Error::method_not_found());
        }

        // Register a oneshot keyed by a fresh request_id, tagged with this
        // channel kind. The plugin-bridge forwarder task consumes it once
        // the plugin's ACP response arrives. The tag lets
        // `PluginHost::cancel_channel_permissions` drain orphaned entries
        // when the plugin dies, so `rx.await` below resolves as `Cancelled`
        // instead of stalling the agent turn.
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel::<acp::RequestPermissionResponse>();
        let routes = self.attached_routes().await;
        let Some(first_route) = routes.first() else {
            return Ok(acp::RequestPermissionResponse::new(
                acp::RequestPermissionOutcome::Cancelled,
            ));
        };
        self.plugin_host
            .pending_permissions
            .insert(request_id.clone(), (first_route.channel_kind.clone(), tx));

        let options_len = args.options.len();
        let payload = match serde_json::to_value(&args) {
            Ok(v) => v,
            Err(e) => {
                self.plugin_host.pending_permissions.remove(&request_id);
                return Err(acp::Error::new(
                    -32603,
                    format!("serialize requestPermission: {}", e),
                ));
            }
        };

        tracing::info!(
            "[ChannelBridgeHandler] request_permission forwarding thread={} routes={} request_id={} options={}",
            self.thread_id,
            routes.len(),
            request_id,
            options_len
        );

        for route in routes {
            self.plugin_host
                .send_output(ChannelOutput::PermissionRequest {
                    route,
                    request_id: request_id.clone(),
                    payload: payload.clone(),
                })
                .await;
        }

        // Wait for plugin response — no timeout by design. If the plugin
        // crashes, `tx` is dropped and `rx.await` errors, which we treat as
        // cancelled so the upstream agent turn gracefully ends.
        match rx.await {
            Ok(response) => Ok(response),
            Err(_) => {
                self.plugin_host.pending_permissions.remove(&request_id);
                tracing::info!(
                    "[ChannelBridgeHandler] request_permission dropped (plugin gone?) thread={} request_id={}",
                    self.thread_id, request_id
                );
                Ok(acp::RequestPermissionResponse::new(
                    acp::RequestPermissionOutcome::Cancelled,
                ))
            }
        }
    }
}
