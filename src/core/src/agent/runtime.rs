//! `Agent` — one live ACP connection to a coding CLI process.
//!
//! Each `Agent` wraps a single ACP `ClientSideConnection` to a real agent
//! subprocess. Northbound it implements `acp::Agent` so callers
//! ([`Conversation`]) use standard ACP methods directly. Southbound
//! `Client` events (`session_notification`, `request_permission`) are
//! forwarded to a caller-supplied [`AgentClientHandler`].
//!
//! Only stdio ACP is supported — no provider trait, no pluggable
//! transport. If another transport is ever needed, reintroduce a trait
//! at that time.
//!
//! [`Conversation`]: crate::conversations::Conversation

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::sync::{watch, Mutex};

use agent_client_protocol as acp;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Callback trait for southbound ACP client events forwarded to the caller.
///
/// The agent calls these methods when the real CLI sends notifications or
/// requests back through the ACP client channel.
#[async_trait::async_trait(?Send)]
pub trait AgentClientHandler: Send + Sync + 'static {
    async fn session_notification(
        &self,
        args: acp::SessionNotification,
    ) -> acp::Result<()>;

    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse>;
}

/// Handle returned from a successful [`Agent::spawn`].
pub struct AgentReady {
    pub agent: Arc<Agent>,
    pub startup_session_id: Option<String>,
    pub initialize: acp::InitializeResponse,
}

/// One live ACP-speaking coding CLI. Northbound: `acp::Agent`. Southbound:
/// delegates to an [`AgentClientHandler`].
pub struct Agent {
    /// The southbound ACP connection to the real agent process.
    conn: acp::ClientSideConnection,
    agent_id: String,
    /// ACP initialize response from first startup.
    initialize: acp::InitializeResponse,
    /// ACP session ID obtained from new_session / load_session.
    session_id: Mutex<Option<String>>,
    /// Cancellation token — signals the agent thread to shut down.
    cancel_tx: watch::Sender<bool>,
}

impl Agent {
    /// Spawn a new agent on a dedicated thread with its own tokio runtime + LocalSet.
    ///
    /// `agent_id` must match an entry in `resources/agents.json`. The
    /// binary is lazily installed on first miss (npm or `install_cmd`).
    pub async fn spawn(
        agent_id: String,
        workspace: &Path,
        resume_session_id: Option<String>,
        client_handler: Arc<dyn AgentClientHandler>,
        extra_env: Vec<(String, String)>,
    ) -> anyhow::Result<AgentReady> {
        let cwd = workspace.to_path_buf();
        let (ready_tx, ready_rx) =
            tokio::sync::oneshot::channel::<anyhow::Result<AgentReady>>();
        let (cancel_tx, cancel_rx) = watch::channel(false);

        let thread_name = format!("{}-agent", agent_id);
        let err_label = agent_id.clone();
        std::thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                run_agent_thread(
                    agent_id,
                    cwd,
                    ready_tx,
                    resume_session_id,
                    client_handler,
                    cancel_tx,
                    cancel_rx,
                    extra_env,
                );
            })
            .with_context(|| format!("Failed to spawn agent thread for {}", err_label))?;

        ready_rx
            .await
            .map_err(|_| anyhow!("Agent thread for {} died during init", err_label))?
    }

    pub fn id(&self) -> &str {
        &self.agent_id
    }

    pub fn initialize_response(&self) -> acp::InitializeResponse {
        self.initialize.clone()
    }

    pub async fn session_id(&self) -> Option<String> {
        self.session_id.lock().await.clone()
    }

    pub async fn shutdown(&self) {
        tracing::info!("[{}-agent] shutdown signaled", self.agent_id);
        let _ = self.cancel_tx.send(true);
    }
}

// ---------------------------------------------------------------------------
// Northbound: implement acp::Agent so callers use standard ACP methods
// ---------------------------------------------------------------------------

#[async_trait::async_trait(?Send)]
impl acp::Agent for Agent {
    async fn initialize(&self, args: acp::InitializeRequest) -> acp::Result<acp::InitializeResponse> {
        self.conn.initialize(args).await
    }

    async fn authenticate(&self, args: acp::AuthenticateRequest) -> acp::Result<acp::AuthenticateResponse> {
        self.conn.authenticate(args).await
    }

    async fn new_session(&self, args: acp::NewSessionRequest) -> acp::Result<acp::NewSessionResponse> {
        let resp = self.conn.new_session(args).await?;
        *self.session_id.lock().await = Some(resp.session_id.to_string());
        Ok(resp)
    }

    async fn load_session(&self, args: acp::LoadSessionRequest) -> acp::Result<acp::LoadSessionResponse> {
        let session_id = args.session_id.clone();
        let resp = self.conn.load_session(args).await?;
        *self.session_id.lock().await = Some(session_id.to_string());
        Ok(resp)
    }

    async fn set_session_mode(&self, args: acp::SetSessionModeRequest) -> acp::Result<acp::SetSessionModeResponse> {
        self.conn.set_session_mode(args).await
    }

    async fn prompt(&self, args: acp::PromptRequest) -> acp::Result<acp::PromptResponse> {
        self.conn.prompt(args).await
    }

    async fn cancel(&self, args: acp::CancelNotification) -> acp::Result<()> {
        self.conn.cancel(args).await
    }

    async fn set_session_config_option(
        &self,
        args: acp::SetSessionConfigOptionRequest,
    ) -> acp::Result<acp::SetSessionConfigOptionResponse> {
        self.conn.set_session_config_option(args).await
    }

    async fn ext_method(&self, args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
        self.conn.ext_method(args).await
    }

    async fn ext_notification(&self, args: acp::ExtNotification) -> acp::Result<()> {
        self.conn.ext_notification(args).await
    }
}

// ---------------------------------------------------------------------------
// Southbound: ACP Client handler that forwards to AgentClientHandler
// ---------------------------------------------------------------------------

struct AgentClient {
    handler: Arc<dyn AgentClientHandler>,
}

#[async_trait::async_trait(?Send)]
impl acp::Client for AgentClient {
    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        self.handler.request_permission(args).await
    }

    async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
        self.handler.session_notification(args).await
    }
}

// ---------------------------------------------------------------------------
// Agent thread entry point
// ---------------------------------------------------------------------------

fn run_agent_thread(
    agent_id: String,
    cwd: PathBuf,
    ready_tx: tokio::sync::oneshot::Sender<anyhow::Result<AgentReady>>,
    resume_session_id: Option<String>,
    client_handler: Arc<dyn AgentClientHandler>,
    cancel_tx: watch::Sender<bool>,
    mut cancel_rx: watch::Receiver<bool>,
    extra_env: Vec<(String, String)>,
) {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            let _ = ready_tx.send(Err(anyhow!("Failed to build agent runtime: {}", e)));
            return;
        }
    };

    runtime.block_on(async move {
        let local = tokio::task::LocalSet::new();
        local
            .run_until(async move {
                let cancel_label = agent_id.clone();
                match init_agent(
                    agent_id, cwd, resume_session_id, client_handler, cancel_tx, extra_env,
                )
                .await
                {
                    Ok(ready) => {
                        let _ = ready_tx.send(Ok(ready));
                        // Wait for cancellation signal
                        let _ = cancel_rx.wait_for(|v| *v).await;
                        tracing::info!("[{}-agent] cancelled, exiting thread", cancel_label);
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                    }
                }
            })
            .await;
    });
}

async fn init_agent(
    agent_id: String,
    cwd: PathBuf,
    resume_session_id: Option<String>,
    client_handler: Arc<dyn AgentClientHandler>,
    cancel_tx: watch::Sender<bool>,
    extra_env: Vec<(String, String)>,
) -> anyhow::Result<AgentReady> {
    use acp::Agent as _;
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    let env_refs: Vec<(&str, &str)> =
        extra_env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let (read_stream, write_stream) = connect_stdio(&agent_id, &cwd, &env_refs).await?;

    let (conn, handle_io) = acp::ClientSideConnection::new(
        AgentClient {
            handler: client_handler,
        },
        write_stream.compat_write(),
        read_stream.compat(),
        |fut| {
            tokio::task::spawn_local(fut);
        },
    );
    let io_label = agent_id.clone();
    tokio::task::spawn_local(async move {
        if let Err(error) = handle_io.await {
            tracing::info!("[{}-agent] ACP IO terminated: {}", io_label, error);
        }
    });

    let init_req = acp::InitializeRequest::new(acp::ProtocolVersion::V1).client_info(
        acp::Implementation::new("vibearound", env!("CARGO_PKG_VERSION")).title("VibeAround"),
    );
    let initialize = conn
        .initialize(init_req)
        .await
        .with_context(|| format!("ACP initialize failed for {}", agent_id))?;

    let startup_session_id = if let Some(resume_session_id) = resume_session_id.clone() {
        match conn
            .load_session(acp::LoadSessionRequest::new(
                resume_session_id.clone(),
                cwd.clone(),
            ))
            .await
        {
            Ok(_) => Some(resume_session_id),
            Err(error) => {
                tracing::info!(
                    "[{}-agent] failed to load session {}, starting without session: {}",
                    agent_id, resume_session_id, error
                );
                None
            }
        }
    } else {
        None
    };

    let agent = Arc::new(Agent {
        conn,
        agent_id,
        initialize: initialize.clone(),
        session_id: Mutex::new(startup_session_id.clone()),
        cancel_tx,
    });

    Ok(AgentReady {
        agent,
        startup_session_id,
        initialize,
    })
}

// ---------------------------------------------------------------------------
// Stdio connection — was `StdioAcpProvider` + `spawn_stdio_acp`
// ---------------------------------------------------------------------------

/// Resolve the agent CLI's launch command, spawn it, and wire stdio as two
/// `DuplexStream`s. Lazily installs the binary on first miss.
async fn connect_stdio(
    agent_id: &str,
    cwd: &Path,
    extra_env: &[(&str, &str)],
) -> anyhow::Result<(DuplexStream, DuplexStream)> {
    let agent_def = crate::resources::agent_by_id(agent_id)
        .ok_or_else(|| anyhow!("No resource definition for agent '{}'", agent_id))?;

    // Resolve program + args based on install method:
    // 1. npm-based agents → `node <resolved_entry>` (Claude ACP, Codex ACP)
    // 2. binary-download agents → binary from ~/.vibearound/bin/ (Cursor, Kiro)
    // 3. native agents → program + args from PATH (Gemini, OpenCode)
    let (program, resolved_args) = if let Some(npm_pkg) = &agent_def.acp.npm_package {
        let bin_name = agent_def.acp.bin_name.as_deref().unwrap_or(npm_pkg);
        if crate::process::env::resolve_acp_agent_bin(bin_name).is_err() {
            tracing::info!("[{}-agent] auto-installing {} ...", agent_id, npm_pkg);
            super::install::auto_install_npm_agent(npm_pkg).await?;
        }
        let entry = crate::process::env::resolve_acp_agent_bin(bin_name).with_context(|| {
            format!("Resolving ACP agent '{}' (npm: {})", agent_id, npm_pkg)
        })?;
        ("node".to_string(), vec![entry.to_string_lossy().to_string()])
    } else if let Some(install_cmd) = &agent_def.acp.install_cmd {
        if !super::install::is_program_available(&agent_def.acp.program) {
            tracing::info!("[{}-agent] auto-installing via install cmd ...", agent_id);
            super::install::auto_install_agent_cmd(install_cmd, agent_id).await?;
        }
        (agent_def.acp.program.clone(), agent_def.acp.args.clone())
    } else {
        (agent_def.acp.program.clone(), agent_def.acp.args.clone())
    };

    let args_refs: Vec<&str> = resolved_args.iter().map(|s| s.as_str()).collect();
    spawn_stdio_process(agent_id, &program, &args_refs, cwd, extra_env)
}

/// Spawn the CLI subprocess and plumb its stdio through tokio DuplexStreams.
fn spawn_stdio_process(
    agent_id: &str,
    program: &str,
    args: &[&str],
    cwd: &Path,
    extra_env: &[(&str, &str)],
) -> anyhow::Result<(DuplexStream, DuplexStream)> {
    tracing::info!(
        "[{}-agent] spawning {} {} in {:?}",
        agent_id, program, args.join(" "), cwd
    );
    let mut cmd = crate::process::env::command(program);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true);
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().with_context(|| {
        format!(
            "Failed to spawn {} {}. Is it installed?",
            program,
            args.join(" ")
        )
    })?;
    tracing::info!("[{}-agent] process spawned pid={:?}", agent_id, child.id());

    let child_stdout = child.stdout.take().context("Process has no stdout")?;
    let child_stdin = child.stdin.take().context("Process has no stdin")?;

    // Transfer ownership of `Child` to the global ChildRegistry. kill_on_drop
    // alone is not enough: the old code moved `child` into the stdout reader
    // closure, which only dropped it on stdout EOF. On abrupt runtime teardown
    // that task never ran its destructor, leaving PPID=1 orphans.
    // The registry's kill_all() path synchronously SIGKILLs every child on
    // daemon stop + Tauri Exit, regardless of task scheduler state.
    let registry_id = crate::process::registry::ChildRegistry::global().register(
        crate::process::registry::ChildKind::AgentAcp,
        format!("{}-agent", agent_id),
        child,
    );

    // stdout → client_read
    let (client_read, mut bridge_write) = tokio::io::duplex(64 * 1024);
    let agent_id_owned = agent_id.to_string();
    tokio::task::spawn_local(async move {
        let mut stdout = child_stdout;
        let mut buf = [0u8; 8192];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if bridge_write.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // Clean shutdown path: pull the child out of the registry and drop
        // it. kill_on_drop fires if the process is still alive.
        if let Some(_c) = crate::process::registry::ChildRegistry::global().remove(registry_id) {
            tracing::info!("[{}-agent] stdout EOF — dropping child via registry", agent_id_owned);
        }
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
                    if stdin.write_all(&buf[..n]).await.is_err() {
                        break;
                    }
                    let _ = stdin.flush().await;
                }
                Err(_) => break,
            }
        }
    });

    Ok((client_read, client_write))
}
