use std::path::Path;

use async_trait::async_trait;

use crate::agent_manager::agents::{claude_acp, runtime_context};
use crate::agent_manager::provider::{AgentKind, AgentProvider, ProviderConnection};

pub struct ClaudeProvider;

#[async_trait]
impl AgentProvider for ClaudeProvider {
    fn kind(&self) -> AgentKind {
        AgentKind::Claude
    }

    fn prepare_workspace(
        &self,
        workspace: &Path,
        _system_prompt: Option<&str>,
        mcp_port: u16,
    ) -> Result<(), String> {
        runtime_context::ensure_mcp_config(self.kind(), workspace, mcp_port);
        Ok(())
    }

    async fn connect(
        &self,
        workspace: &Path,
        system_prompt: Option<&str>,
    ) -> Result<ProviderConnection, String> {
        let (read_stream, write_stream, worker_thread, session_id_rx) =
            claude_acp::spawn_claude_acp(
                workspace.to_path_buf(),
                system_prompt.map(|value| value.to_string()),
            );
        Ok(ProviderConnection {
            read_stream,
            write_stream,
            session_id_rx: Some(session_id_rx),
            worker_thread: Some(worker_thread),
        })
    }
}
