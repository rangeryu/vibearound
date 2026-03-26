use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::io::DuplexStream;
use tokio::sync::mpsc;

use super::providers::{ClaudeProvider, CodexProvider, GeminiProvider, OpenCodeProvider};

/// External CLI/provider session identifier.
pub type ProviderSessionId = String;

/// Low-level ACP transport connection returned by a provider wrapper.
pub struct ProviderConnection {
    pub read_stream: DuplexStream,
    pub write_stream: DuplexStream,
    pub session_id_rx: Option<mpsc::UnboundedReceiver<ProviderSessionId>>,
    pub worker_thread: Option<std::thread::JoinHandle<()>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentKind {
    Claude,
    Gemini,
    OpenCode,
    Codex,
}

impl std::fmt::Display for AgentKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Claude => write!(f, "claude"),
            Self::Gemini => write!(f, "gemini"),
            Self::OpenCode => write!(f, "opencode"),
            Self::Codex => write!(f, "codex"),
        }
    }
}

impl AgentKind {
    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "claude" | "claude-code" => Some(Self::Claude),
            "gemini" | "gemini-cli" => Some(Self::Gemini),
            "opencode" | "open-code" => Some(Self::OpenCode),
            "codex" | "openai-codex" => Some(Self::Codex),
            _ => None,
        }
    }

    pub fn all() -> &'static [AgentKind] {
        &[Self::Claude, Self::Gemini, Self::OpenCode, Self::Codex]
    }

    pub fn enabled() -> Vec<AgentKind> {
        crate::config::ensure_loaded().enabled_agents.clone()
    }

    pub fn is_enabled(&self) -> bool {
        crate::config::ensure_loaded().enabled_agents.contains(self)
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Gemini => "Gemini CLI",
            Self::OpenCode => "Opencode",
            Self::Codex => "Codex CLI",
        }
    }

    pub fn description(&self) -> &'static str {
        match self {
            Self::Claude => "Anthropic Claude Code",
            Self::Gemini => "Google Gemini CLI",
            Self::OpenCode => "OpenCode AI Agent",
            Self::Codex => "OpenAI Codex CLI",
        }
    }
}

#[async_trait]
pub trait AgentProvider: Send + Sync {
    fn kind(&self) -> AgentKind;

    fn prepare_workspace(
        &self,
        workspace: &Path,
        system_prompt: Option<&str>,
        mcp_port: u16,
    ) -> Result<(), String>;

    async fn connect(
        &self,
        workspace: &Path,
        system_prompt: Option<&str>,
    ) -> Result<ProviderConnection, String>;
}

pub fn provider_for_kind(kind: AgentKind) -> Arc<dyn AgentProvider> {
    match kind {
        AgentKind::Claude => Arc::new(ClaudeProvider),
        AgentKind::Gemini => Arc::new(GeminiProvider),
        AgentKind::OpenCode => Arc::new(OpenCodeProvider),
        AgentKind::Codex => Arc::new(CodexProvider),
    }
}
