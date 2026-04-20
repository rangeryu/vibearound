//! Agent integration installation — thin wrapper over `common::agent`.

/// Sync MCP config + skills for enabled/disabled agents.
#[allow(dead_code)]
pub(super) fn install_agent_integrations(settings: &serde_json::Value) -> anyhow::Result<()> {
    common::agent::sync_integrations(settings);
    Ok(())
}

/// Pre-install npm-based ACP agent packages for enabled agents.
#[allow(dead_code)]
pub(super) async fn install_acp_agents(settings: &serde_json::Value) {
    common::agent::install_acp_agents(settings).await;
}
