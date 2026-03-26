//! AgentManager: AcpBridge registry.
//!
//! Responsibilities:
//! - Create / look up / destroy `AcpBridge` instances keyed by route+provider
//! - Expose `get_or_create_bridge()` so SessionHub can obtain an `Arc<AcpBridge>`
//!   (which implements `acp::Agent`)
//! - No event translation, no broadcast channels, no custom enums

use std::sync::Arc;

use dashmap::DashMap;

pub mod agents;
pub mod provider;
pub mod providers;
pub mod runtime;

use self::provider::{provider_for_kind, AgentKind};
use self::runtime::{AcpBridge, BridgeClientHandler};
use crate::config;

fn agent_key(channel_kind: &str, chat_id: &str, profile: &str, cli_kind: &str) -> String {
    format!("{}:{}:{}:{}", channel_kind, chat_id, profile, cli_kind)
}

pub struct AgentManager {
    bridges: DashMap<String, Arc<AcpBridge>>,
}

impl AgentManager {
    pub fn new() -> Self {
        Self {
            bridges: DashMap::new(),
        }
    }

    /// Get or create an AcpBridge for the given route parameters.
    ///
    /// Returns `(bridge, provider_session_id)`.
    pub async fn get_or_create_bridge(
        &self,
        channel_kind: &str,
        chat_id: &str,
        profile: &str,
        cli_kind: &str,
        resume_session_id: Option<String>,
        client_handler: Arc<dyn BridgeClientHandler>,
    ) -> Result<(Arc<AcpBridge>, Option<String>), String> {
        let key = agent_key(channel_kind, chat_id, profile, cli_kind);

        if let Some(entry) = self.bridges.get(&key) {
            let sid = entry.session_id().await;
            return Ok((Arc::clone(&entry), sid));
        }

        let workspace = config::data_dir().join("workspaces");
        std::fs::create_dir_all(&workspace)
            .map_err(|e| format!("Failed to create workspace {:?}: {}", workspace, e))?;

        let kind = AgentKind::from_str_loose(cli_kind).unwrap_or(AgentKind::Claude);
        let provider = provider_for_kind(kind);
        let system_prompt = Some(agents::runtime_context::build_runtime_context(channel_kind));
        let port = config::DEFAULT_PORT;

        let (bridge, provider_sid) = AcpBridge::spawn(
            provider,
            kind,
            &workspace,
            system_prompt.as_deref(),
            resume_session_id,
            port,
            client_handler,
        )
        .await?;

        self.bridges.insert(key.clone(), Arc::clone(&bridge));
        eprintln!("[AgentManager] spawned bridge: {}", key);

        Ok((bridge, provider_sid))
    }

    pub fn get_bridge(
        &self,
        channel_kind: &str,
        chat_id: &str,
        profile: &str,
        cli_kind: &str,
    ) -> Option<Arc<AcpBridge>> {
        let key = agent_key(channel_kind, chat_id, profile, cli_kind);
        self.bridges.get(&key).map(|e| Arc::clone(&e))
    }

    pub async fn kill_bridge(&self, key: &str) {
        if let Some((_, bridge)) = self.bridges.remove(key) {
            bridge.shutdown().await;
            eprintln!("[AgentManager] killed bridge: {}", key);
        }
    }

    pub async fn kill_chat_bridges(&self, channel_kind: &str, chat_id: &str) {
        let prefix = format!("{}:{}:", channel_kind, chat_id);
        let keys: Vec<String> = self
            .bridges
            .iter()
            .filter(|e| e.key().starts_with(&prefix))
            .map(|e| e.key().clone())
            .collect();
        for key in keys {
            self.kill_bridge(&key).await;
        }
    }

    pub async fn shutdown_all(&self) {
        let keys: Vec<String> = self.bridges.iter().map(|e| e.key().clone()).collect();
        for key in keys {
            self.kill_bridge(&key).await;
        }
    }
}
