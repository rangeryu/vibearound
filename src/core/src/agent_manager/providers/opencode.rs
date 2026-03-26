use std::path::Path;

use async_trait::async_trait;

use crate::agent_manager::agents::{opencode_acp, runtime_context};
use crate::agent_manager::provider::{AgentKind, AgentProvider, ProviderConnection};

pub struct OpenCodeProvider;

#[async_trait]
impl AgentProvider for OpenCodeProvider {
    fn kind(&self) -> AgentKind {
        AgentKind::OpenCode
    }

    fn prepare_workspace(
        &self,
        workspace: &Path,
        system_prompt: Option<&str>,
        mcp_port: u16,
    ) -> Result<(), String> {
        runtime_context::ensure_mcp_config(self.kind(), workspace, mcp_port);
        if let Some(system_prompt) = system_prompt {
            std::fs::write(workspace.join("AGENTS.md"), system_prompt)
                .map_err(|e| format!("Failed to write Opencode system prompt: {}", e))?;
        }
        Ok(())
    }

    async fn connect(
        &self,
        workspace: &Path,
        _system_prompt: Option<&str>,
    ) -> Result<ProviderConnection, String> {
        let (read_stream, write_stream) = opencode_acp::spawn_opencode_process(workspace)?;
        Ok(ProviderConnection {
            read_stream,
            write_stream,
            session_id_rx: None,
            worker_thread: None,
        })
    }
}
