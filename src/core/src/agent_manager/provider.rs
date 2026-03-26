use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::io::DuplexStream;
use tokio::sync::mpsc;

use super::agents::runtime_context;

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

// ---------------------------------------------------------------------------
// AgentProvider trait
// ---------------------------------------------------------------------------

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
        AgentKind::Claude => Arc::new(UnimplementedProvider::new(AgentKind::Claude)),
        AgentKind::Gemini => Arc::new(StdioAcpProvider::gemini()),
        AgentKind::OpenCode => Arc::new(StdioAcpProvider::opencode()),
        AgentKind::Codex => Arc::new(UnimplementedProvider::new(AgentKind::Codex)),
    }
}

// ---------------------------------------------------------------------------
// Placeholder providers — kept for config/UI compatibility only
// ---------------------------------------------------------------------------

struct UnimplementedProvider {
    agent_kind: AgentKind,
}

impl UnimplementedProvider {
    fn new(agent_kind: AgentKind) -> Self {
        Self { agent_kind }
    }
}

#[async_trait]
impl AgentProvider for UnimplementedProvider {
    fn kind(&self) -> AgentKind {
        self.agent_kind
    }

    fn prepare_workspace(
        &self,
        _workspace: &Path,
        _system_prompt: Option<&str>,
        _mcp_port: u16,
    ) -> Result<(), String> {
        Ok(())
    }

    async fn connect(
        &self,
        _workspace: &Path,
        _system_prompt: Option<&str>,
    ) -> Result<ProviderConnection, String> {
        Err(format!("{} provider is not implemented yet", self.agent_kind))
    }
}

// ---------------------------------------------------------------------------
// StdioAcpProvider — generic provider for CLIs that speak ACP over stdio
// ---------------------------------------------------------------------------

struct StdioAcpProvider {
    agent_kind: AgentKind,
    /// CLI command, e.g. "gemini", "opencode", "npx"
    program: &'static str,
    /// CLI arguments, e.g. &["--experimental-acp"]
    args: &'static [&'static str],
    /// Where to write the system prompt relative to workspace (None = skip)
    system_prompt_path: Option<SystemPromptTarget>,
}

enum SystemPromptTarget {
    /// Write to a fixed relative path
    File(&'static str),
    /// Write to a path under a directory that must be created first
    FileInDir { dir: &'static str, file: &'static str },
}

impl StdioAcpProvider {
    fn gemini() -> Self {
        Self {
            agent_kind: AgentKind::Gemini,
            program: "gemini",
            args: &["--experimental-acp"],
            system_prompt_path: Some(SystemPromptTarget::FileInDir {
                dir: ".gemini",
                file: ".gemini/system.md",
            }),
        }
    }

    fn opencode() -> Self {
        Self {
            agent_kind: AgentKind::OpenCode,
            program: "opencode",
            args: &["acp"],
            system_prompt_path: Some(SystemPromptTarget::File("AGENTS.md")),
        }
    }
}

#[async_trait]
impl AgentProvider for StdioAcpProvider {
    fn kind(&self) -> AgentKind { self.agent_kind }

    fn prepare_workspace(
        &self,
        workspace: &Path,
        system_prompt: Option<&str>,
        mcp_port: u16,
    ) -> Result<(), String> {
        runtime_context::ensure_mcp_config(self.agent_kind, workspace, mcp_port);
        if let (Some(prompt), Some(target)) = (system_prompt, &self.system_prompt_path) {
            let path = match target {
                SystemPromptTarget::File(rel) => workspace.join(rel),
                SystemPromptTarget::FileInDir { dir, file } => {
                    std::fs::create_dir_all(workspace.join(dir))
                        .map_err(|e| format!("Failed to create dir {}: {}", dir, e))?;
                    workspace.join(file)
                }
            };
            std::fs::write(&path, prompt)
                .map_err(|e| format!("Failed to write system prompt {:?}: {}", path, e))?;
        }
        Ok(())
    }

    async fn connect(
        &self,
        workspace: &Path,
        _system_prompt: Option<&str>,
    ) -> Result<ProviderConnection, String> {
        let (read_stream, write_stream) =
            spawn_stdio_acp(self.agent_kind, self.program, self.args, workspace)?;
        Ok(ProviderConnection {
            read_stream,
            write_stream,
            session_id_rx: None,
            worker_thread: None,
        })
    }
}

/// Spawn a CLI that speaks ACP over stdio, return duplex streams.
fn spawn_stdio_acp(
    kind: AgentKind,
    program: &str,
    args: &[&str],
    cwd: &Path,
) -> Result<(DuplexStream, DuplexStream), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    eprintln!("[{}-acp] spawning {} {} in {:?}", kind, program, args.join(" "), cwd);
    let mut child = tokio::process::Command::new(program)
        .args(args)
        .current_dir(cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn {} {}: {}. Is it installed?", program, args.join(" "), e))?;
    eprintln!("[{}-acp] process spawned pid={:?}", kind, child.id());

    let child_stdout = child.stdout.take().ok_or("No stdout")?;
    let child_stdin = child.stdin.take().ok_or("No stdin")?;

    // stdout → client_read
    let (client_read, mut bridge_write) = tokio::io::duplex(64 * 1024);
    tokio::task::spawn_local(async move {
        let mut stdout = child_stdout;
        let mut buf = [0u8; 8192];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if bridge_write.write_all(&buf[..n]).await.is_err() { break; }
                }
                Err(_) => break,
            }
        }
        drop(child);
    });

    // client_write → stdin
    let (mut bridge_read, client_write) = tokio::io::duplex(64 * 1024);
    tokio::task::spawn_local(async move {
        let mut stdin = child_stdin;
        let mut buf = [0u8; 8192];
        loop {
            match bridge_read.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if stdin.write_all(&buf[..n]).await.is_err() { break; }
                    let _ = stdin.flush().await;
                }
                Err(_) => break,
            }
        }
    });

    Ok((client_read, client_write))
}
