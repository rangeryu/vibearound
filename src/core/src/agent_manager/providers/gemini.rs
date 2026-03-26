use std::path::Path;

use async_trait::async_trait;

use crate::agent_manager::agents::{gemini_acp, runtime_context};
use crate::agent_manager::provider::{AgentKind, AgentProvider, ProviderConnection};

pub struct GeminiProvider;

#[async_trait]
impl AgentProvider for GeminiProvider {
    fn kind(&self) -> AgentKind {
        AgentKind::Gemini
    }

    fn prepare_workspace(
        &self,
        workspace: &Path,
        system_prompt: Option<&str>,
        mcp_port: u16,
    ) -> Result<(), String> {
        runtime_context::ensure_mcp_config(self.kind(), workspace, mcp_port);
        if let Some(system_prompt) = system_prompt {
            let prompt_path = workspace.join(".gemini").join("system.md");
            if let Some(parent) = prompt_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to prepare Gemini prompt dir: {}", e))?;
            }
            std::fs::write(&prompt_path, system_prompt)
                .map_err(|e| format!("Failed to write Gemini system prompt: {}", e))?;
        }
        Ok(())
    }

    async fn connect(
        &self,
        workspace: &Path,
        system_prompt: Option<&str>,
    ) -> Result<ProviderConnection, String> {
        let system_md = system_prompt.map(|_| workspace.join(".gemini").join("system.md"));
        let (read_stream, write_stream) =
            gemini_acp::spawn_gemini_process(workspace, system_md.as_deref())?;
        Ok(ProviderConnection {
            read_stream,
            write_stream,
            session_id_rx: None,
            worker_thread: None,
        })
    }
}
