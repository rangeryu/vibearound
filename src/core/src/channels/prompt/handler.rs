//! `handle_prompt` — the main prompt-processing path.
//!
//! Parses slash commands, short-circuits for built-in actions, or
//! forwards the content blocks to `ConversationManager::prompt` wrapped in a
//! `ChannelBridgeHandler`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_client_protocol::schema as acp;

use crate::agent::AgentClientHandler;
use crate::conversations::ConversationManager;
use crate::routing::RouteKey;
use crate::{agent_state, config, profiles, resources};

use crate::channels::bridge_handler::ChannelBridgeHandler;
use crate::channels::plugin_host::PluginHost;
use crate::channels::slash::{parse_slash_command, SlashAction};
use crate::channels::types::ChannelOutput;

use super::handover::handle_handover;
use super::mode::{handle_set_mode, set_session_mode_and_reply};
use super::send_system_text;

/// Handle a prompt request: process slash commands, then call through to
/// `ConversationManager::prompt`. Returns the real `PromptResponse` with actual
/// `StopReason`.
///
/// Used by both the channel-input processing loop (web) and the stdio
/// plugin transport (where `prompt()` blocks until the turn completes).
pub(crate) async fn handle_prompt(
    conversation_manager: &Arc<ConversationManager>,
    plugin_host: &Arc<PluginHost>,
    route: RouteKey,
    cli_kind: Option<String>,
    mut content_blocks: Vec<acp::ContentBlock>,
) -> acp::Result<acp::PromptResponse> {
    // Extract text from first Text block for slash command parsing
    let text = content_blocks
        .iter()
        .find_map(|b| match b {
            acp::ContentBlock::Text(t) => Some(t.text.clone()),
            _ => None,
        })
        .unwrap_or_default();

    if let Some(action) = parse_slash_command(&text) {
        match action {
            SlashAction::AgentPassthrough(agent_text) => {
                // Replace text in the first Text block, or insert one
                let replaced = content_blocks.iter_mut().any(|b| {
                    if let acp::ContentBlock::Text(t) = b {
                        *t = acp::TextContent::new(&agent_text);
                        true
                    } else {
                        false
                    }
                });
                if !replaced {
                    content_blocks.insert(
                        0,
                        acp::ContentBlock::Text(acp::TextContent::new(agent_text)),
                    );
                }
            }
            SlashAction::NewSession => {
                conversation_manager.reset_session(&route).await;
                send_system_text(plugin_host, &route, "Session reset.").await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::AgentSummary => {
                send_agent_summary(conversation_manager, plugin_host, &route).await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::ListAgents => {
                let text = format_agent_launch_targets(conversation_manager, &route).await;
                send_system_text(plugin_host, &route, &text).await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::AgentSwitch(target) | SlashAction::SwitchAgent(target) => {
                handle_switch_target(conversation_manager, plugin_host, &route, &target).await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::SwitchProfile(profile) => {
                conversation_manager
                    .switch_profile(&route, profile.clone())
                    .await;
                send_system_text(
                    plugin_host,
                    &route,
                    &format!("Switched to profile {}.", profile),
                )
                .await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::WorkspaceList => {
                let text = format_workspace_list(conversation_manager, &route).await;
                send_system_text(plugin_host, &route, &text).await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::WorkspaceSwitch(workspace) => {
                handle_workspace_switch(conversation_manager, plugin_host, &route, &workspace)
                    .await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::Status => {
                let text = format_status(conversation_manager, &route).await;
                send_system_text(plugin_host, &route, &text).await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::Close => {
                conversation_manager
                    .close(&route, Some("user closed".to_string()))
                    .await;
                send_system_text(plugin_host, &route, "Conversation closed.").await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::ShowCommandMenu => {
                let system_commands =
                    serde_json::to_value(&crate::resources::COMMANDS.system_commands)
                        .unwrap_or(serde_json::json!([]));
                plugin_host
                    .send_output(ChannelOutput::CommandMenu {
                        route: route.clone(),
                        system_commands,
                        agent_commands: serde_json::json!([]),
                    })
                    .await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::ListAgentCommands => {
                let state = route_state(conversation_manager, &route).await;
                if !agent_started(state.as_ref()) {
                    send_system_text(
                        plugin_host,
                        &route,
                        "Agent commands are available after the agent session starts. Send a message first, then use /agent --help.",
                    )
                    .await;
                    return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
                }
                let agent_commands = conversation_manager.list_agent_commands(&route).await;
                plugin_host
                    .send_output(ChannelOutput::CommandMenu {
                        route: route.clone(),
                        system_commands: serde_json::json!([]),
                        agent_commands,
                    })
                    .await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::PickupCode(code) => {
                match crate::conversations::handover::pickup_codes::consume(&code) {
                    Some((agent_kind, session_id, cwd)) => {
                        match conversation_manager
                            .prepare_pickup(
                                route.clone(),
                                agent_kind.clone(),
                                session_id.clone(),
                                Some(cwd),
                                None,
                            )
                            .await
                        {
                            Ok(()) => {
                                send_system_text(
                                    plugin_host,
                                    &route,
                                    &format!(
                                        "Session pickup ready (agent={}, session={}).\nSend your next message to continue.",
                                        agent_kind, session_id
                                    ),
                                )
                                .await;
                            }
                            Err(e) => {
                                send_system_text(plugin_host, &route, &format!("❌ {}", e)).await;
                            }
                        }
                    }
                    None => {
                        send_system_text(
                            plugin_host,
                            &route,
                            "❌ Invalid or expired pickup code. Please re-run the handover to get a new code.",
                        )
                        .await;
                    }
                }
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::Pickup {
                agent_kind,
                session_id,
                cwd,
            } => {
                match conversation_manager
                    .prepare_pickup(
                        route.clone(),
                        agent_kind.clone(),
                        session_id.clone(),
                        cwd.clone(),
                        None,
                    )
                    .await
                {
                    Ok(()) => {
                        send_system_text(
                            plugin_host,
                            &route,
                            &format!(
                                "Session pickup ready (agent={}, session={}).\nSend your next message to continue.",
                                agent_kind, session_id
                            ),
                        )
                        .await;
                    }
                    Err(e) => {
                        send_system_text(plugin_host, &route, &format!("❌ {}", e)).await;
                    }
                }
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::Pair(code) => {
                match crate::auth::pair::validate(&code) {
                    Some(_token) => {
                        send_system_text(
                            plugin_host,
                            &route,
                            "✅ Browser paired successfully. You can now access the dashboard.",
                        )
                        .await;
                    }
                    None => {
                        send_system_text(
                            plugin_host,
                            &route,
                            "❌ Invalid or expired pairing code. Please refresh the dashboard page and try again.",
                        )
                        .await;
                    }
                }
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::Handover => {
                handle_handover(conversation_manager, plugin_host, &route).await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::PlanMode => {
                set_session_mode_and_reply(conversation_manager, plugin_host, &route, "plan").await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::SetMode(mode_id) => {
                handle_set_mode(conversation_manager, plugin_host, &route, &mode_id).await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
            SlashAction::Unknown(cmd) => {
                send_system_text(plugin_host, &route, &format!("Unknown command: {}", cmd)).await;
                return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
            }
        }
    }

    if content_blocks.is_empty() {
        return Ok(acp::PromptResponse::new(acp::StopReason::EndTurn));
    }

    tracing::debug!(
        route = %route,
        cli_kind = ?cli_kind,
        blocks = content_blocks.len(),
        "forwarding prompt to ConversationManager"
    );

    let handler: Arc<dyn AgentClientHandler> = Arc::new(ChannelBridgeHandler::new(
        Arc::clone(plugin_host),
        Arc::clone(conversation_manager),
        route.clone(),
    ));

    conversation_manager
        .prompt(route, cli_kind, content_blocks, handler)
        .await
}

async fn route_state(
    conversation_manager: &Arc<ConversationManager>,
    route: &RouteKey,
) -> Option<crate::conversations::ConversationState> {
    match conversation_manager.conversation(route) {
        Some(conversation) => Some(conversation.state().await),
        None => None,
    }
}

#[derive(Debug, Clone)]
struct LaunchSelection {
    agent_id: String,
    agent_label: String,
    profile_id: Option<String>,
    profile_label: Option<String>,
}

fn direct_profile_label(profile_id: Option<&str>) -> String {
    match profile_id {
        Some(profile) if !profile_uses_vibearound_credentials(profile) => "Direct".to_string(),
        Some(profile) => profile_label(profile).unwrap_or_else(|| profile.to_string()),
        None => "Direct".to_string(),
    }
}

fn profile_uses_vibearound_credentials(profile: &str) -> bool {
    !matches!(profile, "default" | "none" | "off" | "direct")
}

fn profile_label(profile_id: &str) -> Option<String> {
    profiles::schema::load(profile_id)
        .map(profiles::normalize_legacy_profile)
        .map(|profile| profile.label)
}

fn agent_label(agent_id: &str) -> String {
    resources::agent_by_id(agent_id)
        .map(|agent| agent.display_name.clone())
        .unwrap_or_else(|| agent_id.to_string())
}

fn resolve_launch_selection(raw: &str) -> Result<LaunchSelection, String> {
    let (agent_part, profile_part) = raw
        .split_once('+')
        .map(|(agent, profile)| (agent.trim(), Some(profile.trim())))
        .unwrap_or_else(|| (raw.trim(), None));
    if agent_part.is_empty() {
        return Err("missing agent name".to_string());
    }
    let agent_id = resources::resolve_agent_id(agent_part)?;
    let agent_label = agent_label(&agent_id);

    let Some(profile_token) = profile_part.filter(|profile| !profile.is_empty()) else {
        return Ok(LaunchSelection {
            agent_id,
            agent_label,
            profile_id: Some("direct".to_string()),
            profile_label: Some("Direct".to_string()),
        });
    };

    if matches!(profile_token, "direct" | "default" | "none" | "off") {
        return Ok(LaunchSelection {
            agent_id,
            agent_label,
            profile_id: Some("direct".to_string()),
            profile_label: Some("Direct".to_string()),
        });
    }

    let profile = resolve_profile_for_agent(&agent_id, profile_token)?;
    Ok(LaunchSelection {
        agent_id,
        agent_label,
        profile_id: Some(profile.id),
        profile_label: Some(profile.label),
    })
}

fn resolve_profile_for_agent(
    agent_id: &str,
    token: &str,
) -> Result<profiles::schema::ProfileDef, String> {
    let token = token.trim();
    let token_lower = token.to_lowercase();
    let candidates: Vec<_> = profiles::ordered_profiles()
        .into_iter()
        .filter(|profile| profiles::connections::profile_can_launch_agent(profile, agent_id))
        .collect();

    if let Some(profile) = candidates.iter().find(|profile| profile.id == token) {
        return Ok(profile.clone());
    }

    let matches: Vec<_> = candidates
        .iter()
        .filter(|profile| {
            profile.provider.eq_ignore_ascii_case(&token_lower)
                || profile.label.eq_ignore_ascii_case(token)
        })
        .cloned()
        .collect();

    match matches.as_slice() {
        [profile] => Ok(profile.clone()),
        [] => Err(format!(
            "profile '{}' cannot launch '{}'. Use /agent --list to see available combinations.",
            token, agent_id
        )),
        _ => Err(format!(
            "profile '{}' is ambiguous for '{}': {}",
            token,
            agent_id,
            matches
                .iter()
                .map(|profile| profile.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

async fn handle_switch_target(
    conversation_manager: &Arc<ConversationManager>,
    plugin_host: &Arc<PluginHost>,
    route: &RouteKey,
    target: &str,
) {
    match resolve_launch_selection(target) {
        Ok(selection) => {
            let profile_id = selection.profile_id.clone();
            match conversation_manager
                .select_launch_route(route, selection.agent_id.clone(), profile_id, None)
                .await
            {
                Ok(_) => {
                    let profile = selection
                        .profile_label
                        .as_deref()
                        .unwrap_or("Direct")
                        .to_string();
                    send_system_text(
                        plugin_host,
                        route,
                        &format!("Switched to {} / {}.", selection.agent_label, profile),
                    )
                    .await;
                }
                Err(error) => {
                    send_system_text(plugin_host, route, &format!("❌ {}", error)).await;
                }
            }
        }
        Err(error) => {
            send_system_text(plugin_host, route, &format!("❌ {}", error)).await;
        }
    }
}

async fn send_agent_summary(
    conversation_manager: &Arc<ConversationManager>,
    plugin_host: &Arc<PluginHost>,
    route: &RouteKey,
) {
    let state = route_state(conversation_manager, route).await;
    let cfg = config::ensure_loaded();
    let agent_prefs = agent_state::read_prefs();
    let agent_id = state
        .as_ref()
        .and_then(|state| state.cli_kind.clone())
        .unwrap_or_else(|| agent_state::resolve_default_agent(&agent_prefs, &cfg));
    let profile = state
        .as_ref()
        .and_then(|state| state.profile.as_deref())
        .map(|profile| direct_profile_label(Some(profile)))
        .unwrap_or_else(|| {
            direct_profile_label(
                agent_state::resolve_default_profile(&agent_prefs, &cfg, &agent_id).as_deref(),
            )
        });
    send_system_text(
        plugin_host,
        route,
        &format!(
            "Current agent: {} / {}\nUse /agent --list to see launch targets.\nUse /agent --help to see current agent commands.\nUse /agent --switch <agent[+profile]> or /switch <agent[+profile]> to switch.",
            agent_label(&agent_id),
            profile
        ),
    )
    .await;
}

async fn format_agent_launch_targets(
    conversation_manager: &Arc<ConversationManager>,
    route: &RouteKey,
) -> String {
    let state = route_state(conversation_manager, route).await;
    let cfg = config::ensure_loaded();
    let agent_prefs = agent_state::read_prefs();
    let current_agent = state
        .as_ref()
        .and_then(|state| state.cli_kind.clone())
        .unwrap_or_else(|| agent_state::resolve_default_agent(&agent_prefs, &cfg));
    let current_profile = state
        .as_ref()
        .and_then(|state| state.profile.clone())
        .or_else(|| agent_state::resolve_default_profile(&agent_prefs, &cfg, &current_agent))
        .unwrap_or_else(|| "direct".to_string());
    let default_agent = agent_state::resolve_default_agent(&agent_prefs, &cfg);
    let default_profile = agent_state::resolve_default_profile(&agent_prefs, &cfg, &default_agent)
        .unwrap_or_else(|| "direct".to_string());
    let profiles = profiles::ordered_profiles();

    let mut lines = vec![
        "Agent launch targets:".to_string(),
        format!(
            "Current: {}",
            launch_key(&current_agent, Some(&current_profile), &profiles)
        ),
        format!(
            "Default: {}",
            launch_key(&default_agent, Some(&default_profile), &profiles)
        ),
        String::new(),
    ];

    let enabled_agents = if cfg.enabled_agents.is_empty() {
        resources::agent_ids()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>()
    } else {
        cfg.enabled_agents.clone()
    };

    for agent_id in enabled_agents {
        let agent_label = agent_label(&agent_id);
        push_launch_target_line(
            &mut lines,
            &agent_id,
            None,
            &agent_label,
            "Direct",
            &current_agent,
            &current_profile,
            &default_agent,
            &default_profile,
            &profiles,
        );
        for profile in profiles
            .iter()
            .filter(|profile| profiles::connections::profile_can_launch_agent(profile, &agent_id))
        {
            push_launch_target_line(
                &mut lines,
                &agent_id,
                Some(profile),
                &agent_label,
                &profile.label,
                &current_agent,
                &current_profile,
                &default_agent,
                &default_profile,
                &profiles,
            );
        }
    }

    lines.push(String::new());
    lines.push("Use /agent --switch <target> to switch.".to_string());
    lines.join("\n")
}

#[allow(clippy::too_many_arguments)]
fn push_launch_target_line(
    lines: &mut Vec<String>,
    agent_id: &str,
    profile: Option<&profiles::schema::ProfileDef>,
    agent_label: &str,
    profile_label: &str,
    current_agent: &str,
    current_profile: &str,
    default_agent: &str,
    default_profile: &str,
    profiles: &[profiles::schema::ProfileDef],
) {
    let profile_id = profile.map(|profile| profile.id.as_str());
    let key = launch_key(agent_id, profile_id, profiles);
    let is_current = agent_id == current_agent && profile_matches(profile_id, current_profile);
    let is_default = agent_id == default_agent && profile_matches(profile_id, default_profile);
    let mut markers = Vec::new();
    if is_current {
        markers.push("current");
    }
    if is_default {
        markers.push("default");
    }
    let marker = if markers.is_empty() {
        String::new()
    } else {
        format!(" ({})", markers.join(", "))
    };
    lines.push(format!(
        "{:<24} {} / {}{}",
        key, agent_label, profile_label, marker
    ));
}

fn profile_matches(profile_id: Option<&str>, current_profile: &str) -> bool {
    match profile_id {
        Some(profile_id) => profile_id == current_profile,
        None => !profile_uses_vibearound_credentials(current_profile),
    }
}

fn launch_key(
    agent_id: &str,
    profile_id: Option<&str>,
    profiles: &[profiles::schema::ProfileDef],
) -> String {
    let Some(profile_id) =
        profile_id.filter(|profile| profile_uses_vibearound_credentials(profile))
    else {
        return agent_id.to_string();
    };
    let Some(profile) = profiles.iter().find(|profile| profile.id == profile_id) else {
        return format!("{}+{}", agent_id, profile_id);
    };
    let same_provider_count = profiles
        .iter()
        .filter(|candidate| candidate.provider == profile.provider)
        .count();
    let token = if same_provider_count == 1 {
        profile.provider.as_str()
    } else {
        profile.id.as_str()
    };
    format!("{}+{}", agent_id, token)
}

async fn format_workspace_list(
    conversation_manager: &Arc<ConversationManager>,
    route: &RouteKey,
) -> String {
    let state = route_state(conversation_manager, route).await;
    if agent_started(state.as_ref()) {
        let current = state
            .and_then(|state| state.workspace)
            .unwrap_or_else(|| "unknown".to_string());
        return format!(
            "Workspace is locked after the agent session starts.\nCurrent workspace: {}",
            current
        );
    }

    let cfg = config::ensure_loaded();
    let agent_prefs = agent_state::read_prefs();
    let agent_id = state
        .as_ref()
        .and_then(|state| state.cli_kind.clone())
        .unwrap_or_else(|| agent_state::resolve_default_agent(&agent_prefs, &cfg));
    let current = state
        .as_ref()
        .and_then(|state| state.workspace.as_ref().map(PathBuf::from))
        .unwrap_or_else(|| agent_state::resolve_agent_workspace(&agent_prefs, &cfg, &agent_id));
    let workspaces = workspace_options(Some(&current));
    let mut lines = vec![
        "Workspaces:".to_string(),
        "Use /workspace <id|name> before the agent starts.".to_string(),
        String::new(),
    ];
    for (index, workspace) in workspaces.iter().enumerate() {
        let marker = if paths_equal(workspace, &current) {
            " (current)"
        } else {
            ""
        };
        lines.push(format!(
            "{:<3} {:<24} {}{}",
            index + 1,
            workspace_name(workspace),
            workspace.to_string_lossy(),
            marker
        ));
    }
    lines.join("\n")
}

async fn handle_workspace_switch(
    conversation_manager: &Arc<ConversationManager>,
    plugin_host: &Arc<PluginHost>,
    route: &RouteKey,
    target: &str,
) {
    let state = route_state(conversation_manager, route).await;
    if agent_started(state.as_ref()) {
        let current = state
            .and_then(|state| state.workspace)
            .unwrap_or_else(|| "unknown".to_string());
        send_system_text(
            plugin_host,
            route,
            &format!(
                "Workspace is locked after the agent session starts.\nCurrent workspace: {}",
                current
            ),
        )
        .await;
        return;
    }

    let cfg = config::ensure_loaded();
    let agent_prefs = agent_state::read_prefs();
    let agent_id = state
        .as_ref()
        .and_then(|state| state.cli_kind.clone())
        .unwrap_or_else(|| agent_state::resolve_default_agent(&agent_prefs, &cfg));
    let current = state
        .as_ref()
        .and_then(|state| state.workspace.as_ref().map(PathBuf::from))
        .unwrap_or_else(|| agent_state::resolve_agent_workspace(&agent_prefs, &cfg, &agent_id));
    let workspaces = workspace_options(Some(&current));
    let workspace = match resolve_workspace_target(target, &workspaces) {
        Ok(workspace) => workspace,
        Err(error) => {
            send_system_text(plugin_host, route, &format!("❌ {}", error)).await;
            return;
        }
    };
    let profile = state.as_ref().and_then(|state| state.profile.clone());
    match conversation_manager
        .select_launch_route(
            route,
            agent_id.clone(),
            profile,
            Some(workspace.to_string_lossy().to_string()),
        )
        .await
    {
        Ok(_) => {
            send_system_text(
                plugin_host,
                route,
                &format!("Workspace set to {}.", workspace.to_string_lossy()),
            )
            .await;
        }
        Err(error) => {
            send_system_text(plugin_host, route, &format!("❌ {}", error)).await;
        }
    }
}

fn agent_started(state: Option<&crate::conversations::ConversationState>) -> bool {
    state.is_some_and(|state| state.session_id.is_some() || state.initialize.is_some())
}

fn workspace_options(current: Option<&Path>) -> Vec<PathBuf> {
    let cfg = config::ensure_loaded();
    let mut out = cfg.all_workspaces();
    if let Some(current) = current {
        if !out.iter().any(|workspace| paths_equal(workspace, current)) {
            out.push(current.to_path_buf());
        }
    }
    out
}

fn resolve_workspace_target(target: &str, workspaces: &[PathBuf]) -> Result<PathBuf, String> {
    let target = target.trim();
    if target.is_empty() || target == "--list" {
        return Err("missing workspace id or name".to_string());
    }
    if let Ok(index) = target.parse::<usize>() {
        return workspaces
            .get(index.saturating_sub(1))
            .cloned()
            .ok_or_else(|| format!("workspace id '{}' not found", target));
    }
    let expanded = expand_home(target);
    if target.starts_with('/') || target == "~" || target.starts_with("~/") {
        if let Some(workspace) = workspaces
            .iter()
            .find(|workspace| paths_equal(workspace, &expanded))
        {
            return Ok(workspace.clone());
        }
        return Err(format!(
            "workspace path '{}' is not registered. Use /workspace to see choices.",
            target
        ));
    }

    let matches: Vec<_> = workspaces
        .iter()
        .filter(|workspace| workspace_name(workspace).eq_ignore_ascii_case(target))
        .cloned()
        .collect();
    match matches.as_slice() {
        [workspace] => Ok(workspace.clone()),
        [] => Err(format!(
            "workspace '{}' not found. Use /workspace to see choices.",
            target
        )),
        _ => Err(format!(
            "workspace '{}' is ambiguous: {}",
            target,
            matches
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

fn workspace_name(path: &Path) -> String {
    if let Some(name) = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
    {
        name.to_string()
    } else {
        path.to_string_lossy().to_string()
    }
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    left == right
        || std::fs::canonicalize(left)
            .ok()
            .zip(std::fs::canonicalize(right).ok())
            .is_some_and(|(left, right)| left == right)
}

fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        config::home_dir()
    } else if let Some(rest) = value.strip_prefix("~/") {
        config::home_dir().join(rest)
    } else {
        PathBuf::from(value)
    }
}

async fn format_status(
    conversation_manager: &Arc<ConversationManager>,
    route: &RouteKey,
) -> String {
    let state = route_state(conversation_manager, route).await;
    let cfg = config::ensure_loaded();
    let agent_prefs = agent_state::read_prefs();
    let agent_id = state
        .as_ref()
        .and_then(|state| state.cli_kind.clone())
        .unwrap_or_else(|| agent_state::resolve_default_agent(&agent_prefs, &cfg));
    let profile = state
        .as_ref()
        .and_then(|state| state.profile.clone())
        .or_else(|| agent_state::resolve_default_profile(&agent_prefs, &cfg, &agent_id))
        .unwrap_or_else(|| "direct".to_string());
    let workspace = state
        .as_ref()
        .and_then(|state| state.workspace.clone())
        .unwrap_or_else(|| {
            agent_state::resolve_agent_workspace(&agent_prefs, &cfg, &agent_id)
                .to_string_lossy()
                .to_string()
        });
    let session = state
        .as_ref()
        .and_then(|state| state.session_id.clone())
        .unwrap_or_else(|| "not started".to_string());
    let mode = state
        .as_ref()
        .and_then(|state| state.session_mode.as_ref())
        .and_then(|mode| mode.get("currentValue"))
        .and_then(|value| value.as_str())
        .unwrap_or("default");
    let state_label = match state.as_ref() {
        Some(state) if state.failed.is_some() => "failed",
        Some(state) if state.busy => "busy",
        Some(state) if state.session_id.is_some() => "idle",
        Some(state) if state.initialize.is_some() => "agent ready",
        _ => "not started",
    };
    let failed = state
        .as_ref()
        .and_then(|state| state.failed.as_ref())
        .map(|error| format!("\nError: {}", error))
        .unwrap_or_default();

    format!(
        "Status:\nAgent: {}\nProfile: {}\nWorkspace: {}\nWorkspace locked: {}\nSession: {}\nMode: {}\nState: {}{}",
        agent_label(&agent_id),
        direct_profile_label(Some(&profile)),
        workspace,
        if agent_started(state.as_ref()) { "yes" } else { "no" },
        session,
        mode,
        state_label,
        failed
    )
}
