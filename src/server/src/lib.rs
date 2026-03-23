//! VibeAround server crate: Axum HTTP + WebSocket, and the unified ServerDaemon entry point.

mod web_server;

pub use web_server::run_web_server;

use std::path::PathBuf;
use std::sync::Arc;

use tokio::task::JoinHandle;

use common::agent_manager::AgentManager;
use common::channel_manager::channels::web::WebChannelManager;
use common::channel_manager::ChannelManager;
use common::config;
use common::plugins;
use common::pty::{PtySessionManager, SessionId};
use common::service::ServiceStatusManager;
use common::session_hub::types::HubEvent;
use common::session_hub::SessionHub;
use common::tunnels;

/// Unified daemon that starts and manages all VibeAround services.
/// Both the server binary and the desktop (Tauri) binary use this.
pub struct ServerDaemon {
    pub services: Arc<ServiceStatusManager>,
    pub port: u16,
}

pub struct RunningDaemon {
    pub channel_hub: Arc<ChannelManager>,
    pub session_hub: Arc<SessionHub>,
    pub agent_hub: Arc<AgentManager>,
    pub web_channel: Arc<WebChannelManager>,
    pub web_handle: JoinHandle<Result<(), String>>,
    pub tunnel_handle: JoinHandle<()>,
    pub web_dispatch_handle: JoinHandle<()>,
    pub agent_status_sync_handle: JoinHandle<()>,
    pub services: Arc<ServiceStatusManager>,
}

impl RunningDaemon {
    pub async fn stop(&self) {
        self.session_hub.shutdown_all().await;
        self.agent_hub.shutdown_all().await;
        self.channel_hub.shutdown_all().await;

        let pty_manager = PtySessionManager::from_registry(Arc::clone(&self.services.pty));
        let session_ids: Vec<SessionId> = self.services.pty.iter().map(|entry| entry.key().clone()).collect();
        for session_id in session_ids {
            let _ = pty_manager.delete_session(session_id);
        }

        self.web_dispatch_handle.abort();
        self.agent_status_sync_handle.abort();
        self.web_handle.abort();
        self.tunnel_handle.abort();
    }
}

impl ServerDaemon {
    pub fn new(port: u16) -> Self {
        Self {
            services: Arc::new(ServiceStatusManager::new(port)),
            port,
        }
    }

    /// Get a clone of the ServiceStatusManager Arc (for Tauri state injection, etc.)
    pub fn services(&self) -> Arc<ServiceStatusManager> {
        Arc::clone(&self.services)
    }

    pub async fn start_background(&self, dist_path: PathBuf) -> Result<RunningDaemon, String> {
        // Check if another instance is already running on the same port
        if let Ok(_) = tokio::net::TcpStream::connect(("127.0.0.1", self.port)).await {
            eprintln!(
                "[VibeAround] ⚠️  Another instance is already running on port {}. \
                 The new instance will fail to bind.",
                self.port
            );
        }

        let cfg = config::ensure_loaded();
        let services = Arc::clone(&self.services);

        // 1. Initialize hub architecture (two-phase init to avoid circular Arc)
        let channel_hub = Arc::new(ChannelManager::new());
        let session_hub = Arc::new(SessionHub::new());
        let agent_hub = Arc::new(AgentManager::new());
        let web_channel = WebChannelManager::new();

        // Wire up cross-references
        channel_hub.set_session_hub(Arc::clone(&session_hub));
        agent_hub.set_session_hub(Arc::clone(&session_hub));

        // Register built-in internal channels.
        let (web_outbound_tx, mut web_outbound_rx) = web_channel.sender();
        channel_hub.start_internal_plugin("web", web_outbound_tx);
        let web_dispatch_handle = {
            let web_channel = Arc::clone(&web_channel);
            tokio::spawn(async move {
                while let Some(notif) = web_outbound_rx.recv().await {
                    web_channel.dispatch_notification(notif);
                }
            })
        };

        // 2. Channel plugins — start plugins for each channel in settings.json
        let discovered_plugins = plugins::discover_channel_plugins();
        for name in cfg.channel_names() {
            let Some(plugin) = discovered_plugins.get(&name) else {
                eprintln!("[VibeAround][daemon] no plugin found for channel '{}', skipping", name);
                continue;
            };

            if let Some(abort_handle) = channel_hub
                .start_plugin(plugin.dir.clone(), plugin.entry_path(), &name)
                .await
            {
                services.register_channel(&name, abort_handle);
            }
        }

        // 3. Subscribe to hub events → sync to ServiceStatusManager → Dashboard
        let hub_services = Arc::clone(&services);
        let mut agent_hub_rx = agent_hub.subscribe();
        let agent_status_sync_handle = tokio::spawn(async move {
            while let Ok(event) = agent_hub_rx.recv().await {
                match event {
                    HubEvent::OnAgentSpawned { key, kind } => {
                        eprintln!("[daemon] agent spawned: {} ({})", key, kind);
                        hub_services.add_agent(key, kind);
                    }
                    HubEvent::OnAgentKilled { key } => {
                        eprintln!("[daemon] agent killed: {}", key);
                        hub_services.remove_agent(&key);
                    }
                    _ => {}
                }
            }
        });

        // 4. Web server (Axum)
        let web_services = Arc::clone(&services);
        let web_channel_hub = Arc::clone(&channel_hub);
        let web_channel_manager = Arc::clone(&web_channel);
        let web_handle = tokio::spawn(async move {
            run_web_server(
                common::config::DEFAULT_PORT,
                dist_path,
                web_services,
                web_channel_hub,
                web_channel_manager,
            )
            .await
            .map_err(|e| e.to_string())
        });

        // 5. Tunnel
        let tunnel_provider = cfg.tunnel_provider;
        eprintln!("[VibeAround][daemon] Tunnel ({})", tunnel_provider.as_str());
        let tunnel_services = Arc::clone(&services);
        let tunnel_handle = tokio::spawn(async move {
            match tunnels::start_web_tunnel_with_provider(tunnel_provider, &cfg).await {
                Ok((guard, url)) => {
                    eprintln!("[VibeAround][daemon] Tunnel URL: {}", url);
                    tunnel_services.set_tunnel_url(tunnel_provider.as_str(), &url);
                    guard.wait().await;
                }
                Err(e) => {
                    eprintln!("[VibeAround][daemon] Tunnel failed: {}", e);
                }
            }
        });
        services.register_tunnel(tunnel_provider, tunnel_handle.abort_handle());

        Ok(RunningDaemon {
            channel_hub,
            session_hub,
            agent_hub,
            web_channel,
            web_handle,
            tunnel_handle,
            web_dispatch_handle,
            agent_status_sync_handle,
            services,
        })
    }

    /// Start all services and wait for shutdown (ctrl_c or web server exit).
    pub async fn start(&self, dist_path: PathBuf) -> Result<(), String> {
        let mut running = self.start_background(dist_path).await?;

        tokio::select! {
            result = &mut running.web_handle => {
                match result {
                    Ok(Ok(())) => eprintln!("[VibeAround][daemon] web server stopped"),
                    Ok(Err(e)) => eprintln!("[VibeAround][daemon] web server error: {}", e),
                    Err(e) => eprintln!("[VibeAround][daemon] web server panic: {}", e),
                }
                running.tunnel_handle.abort();
            }
            _ = tokio::signal::ctrl_c() => {
                eprintln!("\n[VibeAround][daemon] shutting down...");
                running.stop().await;
            }
        }

        Ok(())
    }
}
