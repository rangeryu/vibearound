use std::path::Path;

use async_trait::async_trait;

use crate::agent_manager::agents::{codex_acp, runtime_context};
use crate::agent_manager::provider::{AgentKind, AgentProvider, ProviderConnection};

pub struct CodexProvider;

#[async_trait]
impl AgentProvider for CodexProvider {
    fn kind(&self) -> AgentKind {
        AgentKind::Codex
    }

    fn prepare_workspace(
        &self,
        workspace: &Path,
        system_prompt: Option<&str>,
        mcp_port: u16,
    ) -> Result<(), String> {
        runtime_context::ensure_mcp_config(self.kind(), workspace, mcp_port);
        if let Some(system_prompt) = system_prompt {
            let instructions_dir = workspace.join(".codex");
            std::fs::create_dir_all(&instructions_dir)
                .map_err(|e| format!("Failed to prepare Codex config dir: {}", e))?;
            std::fs::write(instructions_dir.join("instructions.md"), system_prompt)
                .map_err(|e| format!("Failed to write Codex system prompt: {}", e))?;
        }
        Ok(())
    }

    async fn connect(
        &self,
        workspace: &Path,
        _system_prompt: Option<&str>,
    ) -> Result<ProviderConnection, String> {
        let (read_stream, write_stream) = codex_acp::spawn_codex_process(workspace)?;
        Ok(ProviderConnection {
            read_stream,
            write_stream,
            session_id_rx: None,
            worker_thread: None,
        })
    }
}
