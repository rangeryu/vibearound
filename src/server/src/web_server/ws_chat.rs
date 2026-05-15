//! WebSocket handler for web chat channel.
//!
//! - GET /ws/chat — ACP-native websocket adapter
//!
//! Inbound user messages are dispatched to ConversationManager via the channel-input
//! thread (fire-and-forget through ChannelManager). ACP events flow back
//! through the WebChannelManager outbound channel to the websocket,
//! wrapped in a tagged [`crate::api_types::ChatEvent`] envelope so the
//! frontend can discriminate exhaustively.

use axum::extract::{
    ws::{Message, WebSocket, WebSocketUpgrade},
    State,
};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use uuid::Uuid;

use agent_client_protocol::schema as acp;
use common::channels::{ChannelEnvelope, ChannelInput, ChannelOutput};
use common::routing::RouteKey;
use common::{agent_state, config};

use crate::api_types::{AgentInfo, ChatEvent};

use super::AppState;

/// WebSocket upgrade handler for web chat.
pub async fn ws_chat_handler(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle_chat_socket(socket, state))
}

async fn handle_chat_socket(socket: WebSocket, state: AppState) {
    let chat_id = Uuid::new_v4().to_string();
    let channel_id = format!("web:{}", chat_id);
    let route = RouteKey::new("web", &chat_id);

    // Register this connection for outbound ACP events
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ChannelOutput>();
    state.web_channel.register_connection(chat_id.clone(), tx);

    let (mut ws_tx, mut ws_rx) = socket.split();

    // Load config + verbose flags once — verbose filter drops
    // thinking/tool_call frames on the server side when disabled rather
    // than forcing every client to filter.
    let cfg = config::ensure_loaded();
    let agent_prefs = agent_state::read_prefs();
    let verbose = {
        let v = cfg.channel_verbose("ws");
        if !v.show_thinking && !v.show_tool_use {
            cfg.channel_verbose("web")
        } else {
            v
        }
    };

    // Send initial config event.
    let config_event = ChatEvent::Config {
        channel_id: channel_id.clone(),
        agents: AgentInfo::for_ids(&cfg.enabled_agents),
        default_agent: agent_state::resolve_default_agent(&agent_prefs, &cfg),
    };
    if send_event(&mut ws_tx, &config_event).await.is_err() {
        state.web_channel.unregister_connection(&chat_id);
        return;
    }

    // Outbound: drain ChannelOutput → ChatEvent → websocket.
    let outbound_task = tokio::spawn(async move {
        while let Some(output) = rx.recv().await {
            let Some(event) = output_to_chat_event(output, &verbose) else {
                continue;
            };
            if send_event(&mut ws_tx, &event).await.is_err() {
                break;
            }
        }
    });

    // Inbound: ws messages → channel-input thread / permission bridge.
    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Text(text) => {
                if let Some(input) = parse_web_chat_input(&chat_id, &text) {
                    match input {
                        WebChatInput::Message {
                            input,
                            profile,
                            session_intent,
                        } => {
                            if let Some(route) = input_route(&input) {
                                match session_intent {
                                    Some(WebChatSessionIntent::Resume {
                                        agent,
                                        session_id,
                                        cwd,
                                    }) => {
                                        apply_web_session_resume(
                                            &state, &route, agent, profile, session_id, cwd,
                                        )
                                        .await;
                                    }
                                    Some(WebChatSessionIntent::New { cwd }) => {
                                        apply_web_launch_selection(
                                            &state, &route, &input, profile, cwd,
                                        )
                                        .await;
                                        state
                                            .channel_hub
                                            .conversation_manager()
                                            .reset_session(&route)
                                            .await;
                                    }
                                    None => {
                                        apply_web_launch_selection(
                                            &state, &route, &input, profile, None,
                                        )
                                        .await;
                                    }
                                }
                            }
                            state.channel_hub.handle_input(input);
                        }
                        WebChatInput::Stop(input) => {
                            state.channel_hub.handle_input(input);
                        }
                        WebChatInput::PermissionResponse {
                            request_id,
                            response,
                        } => {
                            if let Err(error) =
                                state
                                    .channel_hub
                                    .respond_permission("web", &request_id, response)
                            {
                                tracing::warn!(
                                    request_id = %request_id,
                                    error = %error,
                                    "web permission response ignored"
                                );
                            }
                        }
                        WebChatInput::ResumeSession {
                            agent,
                            profile,
                            session_id,
                            cwd,
                        } => {
                            apply_web_session_resume_now(
                                &state, &route, agent, profile, session_id, cwd,
                            )
                            .await;
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    outbound_task.abort();
    state.web_channel.unregister_connection(&chat_id);
    state
        .channel_hub
        .conversation_manager()
        .close(&route, None)
        .await;
}

fn input_route(input: &ChannelInput) -> Option<RouteKey> {
    match input {
        ChannelInput::Message { envelope }
        | ChannelInput::Callback {
            envelope,
            action_value: _,
        } => Some(envelope.route.clone()),
        ChannelInput::Stop { route } | ChannelInput::Close { route, .. } => Some(route.clone()),
        ChannelInput::SwitchAgent { route, .. } => Some(route.clone()),
        ChannelInput::Log { .. } => None,
    }
}

fn input_agent(input: &ChannelInput) -> Option<String> {
    match input {
        ChannelInput::Message { envelope }
        | ChannelInput::Callback {
            envelope,
            action_value: _,
        } => envelope.cli_kind.clone(),
        _ => None,
    }
}

async fn apply_web_launch_selection(
    state: &AppState,
    route: &RouteKey,
    input: &ChannelInput,
    profile: Option<String>,
    workspace: Option<String>,
) {
    let Some(agent) = input_agent(input) else {
        return;
    };
    if profile.is_none() && workspace.is_none() {
        return;
    }
    if let Err(error) = state
        .channel_hub
        .conversation_manager()
        .select_launch_route(route, agent, profile, workspace)
        .await
    {
        send_web_system_text(state, route, &format!("❌ {}", error)).await;
    }
}

async fn apply_web_session_resume(
    state: &AppState,
    route: &RouteKey,
    agent: Option<String>,
    profile: Option<String>,
    session_id: String,
    cwd: Option<String>,
) {
    let Some(resume) =
        resolve_web_session_resume(state, route, agent, profile, session_id, cwd).await
    else {
        return;
    };

    if let Err(error) = state
        .channel_hub
        .conversation_manager()
        .prepare_pickup(
            route.clone(),
            resume.agent,
            resume.session_id,
            Some(resume.cwd),
            resume.profile,
        )
        .await
    {
        send_web_system_text(state, route, &format!("❌ {}", error)).await;
    }
}

async fn apply_web_session_resume_now(
    state: &AppState,
    route: &RouteKey,
    agent: Option<String>,
    profile: Option<String>,
    session_id: String,
    cwd: Option<String>,
) {
    let Some(resume) =
        resolve_web_session_resume(state, route, agent, profile, session_id, cwd).await
    else {
        return;
    };

    if let Err(error) = state
        .channel_hub
        .resume_session(
            route,
            resume.agent,
            resume.session_id,
            Some(resume.cwd),
            resume.profile,
        )
        .await
    {
        send_web_system_text(state, route, &format!("❌ {}", error)).await;
    }
}

struct WebSessionResume {
    agent: String,
    profile: Option<String>,
    session_id: String,
    cwd: String,
}

async fn resolve_web_session_resume(
    state: &AppState,
    route: &RouteKey,
    agent: Option<String>,
    profile: Option<String>,
    session_id: String,
    cwd: Option<String>,
) -> Option<WebSessionResume> {
    let manager = state.channel_hub.conversation_manager();
    let current_state = match manager.conversation(route) {
        Some(conversation) => Some(conversation.state().await),
        None => None,
    };
    let cfg = config::ensure_loaded();
    let agent_prefs = agent_state::read_prefs();
    let agent = agent
        .or_else(|| {
            current_state
                .as_ref()
                .and_then(|state| state.cli_kind.clone())
        })
        .unwrap_or_else(|| agent_state::resolve_default_agent(&agent_prefs, &cfg));
    let canonical_agent = match common::resources::resolve_agent_id(&agent) {
        Ok(agent_id) => agent_id,
        Err(error) => {
            send_web_system_text(state, route, &format!("❌ {}", error)).await;
            return None;
        }
    };

    if current_state.as_ref().is_some_and(|state| {
        let profile_matches = profile
            .as_deref()
            .map(|profile| state.profile.as_deref() == Some(profile))
            .unwrap_or(true);
        state.session_id.as_deref() == Some(session_id.as_str())
            && state.cli_kind.as_deref() == Some(canonical_agent.as_str())
            && profile_matches
    }) {
        return None;
    }

    let cwd = cwd
        .or_else(|| {
            current_state
                .as_ref()
                .and_then(|state| state.workspace.clone())
        })
        .unwrap_or_else(|| {
            cfg.resolve_workspace(&canonical_agent)
                .to_string_lossy()
                .to_string()
        });

    Some(WebSessionResume {
        agent: canonical_agent,
        profile,
        session_id,
        cwd,
    })
}

async fn send_web_system_text(state: &AppState, route: &RouteKey, text: &str) {
    state
        .channel_hub
        .send_output(ChannelOutput::SystemText {
            route: route.clone(),
            text: text.to_string(),
            reply_to: None,
        })
        .await;
}

async fn send_event<S>(ws_tx: &mut S, event: &ChatEvent) -> Result<(), ()>
where
    S: SinkExt<Message, Error = axum::Error> + Unpin,
{
    let body = match serde_json::to_string(event) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "ws_chat serialize failed");
            return Ok(());
        }
    };
    ws_tx.send(Message::Text(body.into())).await.map_err(|_| ())
}

enum WebChatInput {
    Message {
        input: ChannelInput,
        profile: Option<String>,
        session_intent: Option<WebChatSessionIntent>,
    },
    Stop(ChannelInput),
    PermissionResponse {
        request_id: String,
        response: acp::RequestPermissionResponse,
    },
    ResumeSession {
        agent: Option<String>,
        profile: Option<String>,
        session_id: String,
        cwd: Option<String>,
    },
}

enum WebChatSessionIntent {
    Resume {
        agent: Option<String>,
        session_id: String,
        cwd: Option<String>,
    },
    New { cwd: Option<String> },
}

fn parse_web_chat_input(chat_id: &str, text: &str) -> Option<WebChatInput> {
    let parsed = serde_json::from_str::<serde_json::Value>(text);

    match parsed {
        Ok(v) => {
            let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
            match ty {
                "message" => {
                    let text = v.get("text").and_then(|x| x.as_str()).unwrap_or("").trim();
                    if text.is_empty() {
                        return None;
                    }
                    let message_id = v
                        .get("messageId")
                        .and_then(|x| x.as_str())
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| Uuid::new_v4().to_string());
                    let agent = parse_web_agent(&v);
                    let session_intent = parse_web_session_intent(&v, agent.clone());
                    let profile = parse_web_profile(&v);
                    Some(WebChatInput::Message {
                        input: ChannelInput::Message {
                            envelope: ChannelEnvelope {
                                route: RouteKey::new("web", chat_id),
                                message_id,
                                turn_id: None,
                                text: text.to_string(),
                                sender_id: "web-user".to_string(),
                                attachments: vec![],
                                parent_id: None,
                                cli_kind: agent,
                            },
                        },
                        profile,
                        session_intent,
                    })
                }
                "resume_session" => {
                    let agent = parse_web_agent(&v);
                    let profile = parse_web_profile(&v);
                    let session_id = v
                        .get("sessionId")
                        .and_then(|x| x.as_str())
                        .map(str::trim)
                        .filter(|x| !x.is_empty())?
                        .to_string();
                    let cwd = v
                        .get("sessionWorkspace")
                        .and_then(|x| x.as_str())
                        .map(str::trim)
                        .filter(|x| !x.is_empty())
                        .map(ToOwned::to_owned);

                    Some(WebChatInput::ResumeSession {
                        agent,
                        profile,
                        session_id,
                        cwd,
                    })
                }
                "stop" => Some(WebChatInput::Stop(ChannelInput::Stop {
                    route: RouteKey::new("web", chat_id),
                })),
                "permission_response" => {
                    let request_id = v.get("requestId").and_then(|x| x.as_str())?.to_string();
                    let outcome = match v.get("outcome").and_then(|x| x.as_str()) {
                        Some("cancelled") => acp::RequestPermissionOutcome::Cancelled,
                        _ => {
                            let option_id = v.get("optionId").and_then(|x| x.as_str())?;
                            acp::RequestPermissionOutcome::Selected(
                                acp::SelectedPermissionOutcome::new(option_id.to_string()),
                            )
                        }
                    };
                    Some(WebChatInput::PermissionResponse {
                        request_id,
                        response: acp::RequestPermissionResponse::new(outcome),
                    })
                }
                _ => None,
            }
        }
        Err(_) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(WebChatInput::Message {
                    input: ChannelInput::Message {
                        envelope: ChannelEnvelope {
                            route: RouteKey::new("web", chat_id),
                            message_id: Uuid::new_v4().to_string(),
                            turn_id: None,
                            text: trimmed.to_string(),
                            sender_id: "web-user".to_string(),
                            attachments: vec![],
                            parent_id: None,
                            cli_kind: None,
                        },
                    },
                    profile: None,
                    session_intent: None,
                })
            }
        }
    }
}

fn parse_web_agent(value: &serde_json::Value) -> Option<String> {
    value
        .get("agent")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_web_profile(value: &serde_json::Value) -> Option<String> {
    value
        .get("profileId")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_web_session_intent(
    value: &serde_json::Value,
    agent: Option<String>,
) -> Option<WebChatSessionIntent> {
    match value.get("sessionAction").and_then(|x| x.as_str()) {
        Some("new") => {
            return Some(WebChatSessionIntent::New {
                cwd: parse_web_session_workspace(value),
            });
        }
        Some("resume") | None => {}
        Some(_) => return None,
    }

    let session_id = value
        .get("sessionId")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|x| !x.is_empty())?;
    let cwd = parse_web_session_workspace(value);

    Some(WebChatSessionIntent::Resume {
        agent,
        session_id: session_id.to_string(),
        cwd,
    })
}

fn parse_web_session_workspace(value: &serde_json::Value) -> Option<String> {
    value
        .get("sessionWorkspace")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(ToOwned::to_owned)
}

/// Translate a `ChannelOutput` into a wire `ChatEvent`. Returns `None`
/// when the event should be dropped per the caller's verbose filter
/// (thinking / tool-use chunks when the user has opted out).
fn output_to_chat_event(
    output: ChannelOutput,
    verbose: &common::config::ImVerboseConfig,
) -> Option<ChatEvent> {
    match output {
        ChannelOutput::RawAcp { payload, .. } => acp_passthrough(payload, verbose),
        ChannelOutput::SystemText { text, .. } => Some(ChatEvent::SystemText { text }),
        ChannelOutput::AgentReady { agent, version, .. } => {
            Some(ChatEvent::AgentReady { agent, version })
        }
        ChannelOutput::SessionReady { session_id, .. } => {
            Some(ChatEvent::SessionReady { session_id })
        }
        ChannelOutput::CommandMenu {
            system_commands,
            agent_commands,
            ..
        } => Some(ChatEvent::CommandMenu {
            system_commands,
            agent_commands,
        }),
        ChannelOutput::PermissionRequest {
            request_id,
            payload,
            ..
        } => Some(ChatEvent::PermissionRequest {
            request_id,
            request: payload,
        }),
        ChannelOutput::PromptDone { message_id, .. } => Some(ChatEvent::PromptDone { message_id }),
    }
}

/// Pass ACP session notifications through as `AcpNotification`. The
/// only server-side policy applied is the verbose filter: drop
/// thinking/tool_call frames when the user has opted out so clients
/// don't have to re-implement the same filter.
fn acp_passthrough(
    payload: serde_json::Value,
    verbose: &common::config::ImVerboseConfig,
) -> Option<ChatEvent> {
    let variant = payload
        .pointer("/update/sessionUpdate")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match variant {
        "agent_thought_chunk" if !verbose.show_thinking => None,
        "tool_call" | "tool_call_update" if !verbose.show_tool_use => None,
        _ => Some(ChatEvent::AcpNotification { payload }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_selected_permission_response() {
        let input = parse_web_chat_input(
            "chat-1",
            r#"{"type":"permission_response","requestId":"req-1","optionId":"allow-once"}"#,
        )
        .expect("permission response");

        let WebChatInput::PermissionResponse {
            request_id,
            response,
        } = input
        else {
            panic!("expected permission response");
        };

        assert_eq!(request_id, "req-1");
        match response.outcome {
            acp::RequestPermissionOutcome::Selected(selected) => {
                assert_eq!(selected.option_id.to_string(), "allow-once");
            }
            acp::RequestPermissionOutcome::Cancelled => panic!("expected selected outcome"),
            _ => panic!("expected selected outcome"),
        }
    }

    #[test]
    fn parses_cancelled_permission_response() {
        let input = parse_web_chat_input(
            "chat-1",
            r#"{"type":"permission_response","requestId":"req-2","outcome":"cancelled"}"#,
        )
        .expect("permission response");

        let WebChatInput::PermissionResponse {
            request_id,
            response,
        } = input
        else {
            panic!("expected permission response");
        };

        assert_eq!(request_id, "req-2");
        assert!(matches!(
            response.outcome,
            acp::RequestPermissionOutcome::Cancelled
        ));
    }

    #[test]
    fn parses_stop_message() {
        let input = parse_web_chat_input("chat-1", r#"{"type":"stop"}"#).expect("stop input");

        let WebChatInput::Stop(ChannelInput::Stop { route }) = input else {
            panic!("expected stop input");
        };

        assert_eq!(route, RouteKey::new("web", "chat-1"));
    }

    #[test]
    fn parses_resume_session_intent() {
        let input = parse_web_chat_input(
            "chat-1",
            r#"{"type":"message","text":"continue","agent":"codex","sessionAction":"resume","sessionId":"sid-1","sessionWorkspace":"/tmp/project"}"#,
        )
        .expect("message input");

        let WebChatInput::Message {
            input:
                ChannelInput::Message {
                    envelope:
                        ChannelEnvelope {
                            cli_kind: Some(agent),
                            ..
                        },
                },
            profile: None,
            session_intent:
                Some(WebChatSessionIntent::Resume {
                    agent: Some(intent_agent),
                    session_id,
                    cwd: Some(cwd),
                }),
        } = input
        else {
            panic!("expected resume message");
        };

        assert_eq!(agent, "codex");
        assert_eq!(intent_agent, "codex");
        assert_eq!(session_id, "sid-1");
        assert_eq!(cwd, "/tmp/project");
    }

    #[test]
    fn parses_direct_resume_session() {
        let input = parse_web_chat_input(
            "chat-1",
            r#"{"type":"resume_session","agent":"codex","profileId":"deepseek","sessionId":"sid-1","sessionWorkspace":"/tmp/project"}"#,
        )
        .expect("resume session input");

        let WebChatInput::ResumeSession {
            agent: Some(agent),
            profile: Some(profile),
            session_id,
            cwd: Some(cwd),
        } = input
        else {
            panic!("expected direct resume input");
        };

        assert_eq!(agent, "codex");
        assert_eq!(profile, "deepseek");
        assert_eq!(session_id, "sid-1");
        assert_eq!(cwd, "/tmp/project");
    }

    #[test]
    fn parses_new_session_intent() {
        let input = parse_web_chat_input(
            "chat-1",
            r#"{"type":"message","text":"start over","sessionAction":"new"}"#,
        )
        .expect("message input");

        let WebChatInput::Message {
            session_intent: Some(WebChatSessionIntent::New { cwd: None }),
            ..
        } = input
        else {
            panic!("expected new-session message");
        };
    }

    #[test]
    fn parses_new_session_workspace() {
        let input = parse_web_chat_input(
            "chat-1",
            r#"{"type":"message","text":"start here","sessionAction":"new","sessionWorkspace":"/tmp/new-project"}"#,
        )
        .expect("message input");

        let WebChatInput::Message {
            session_intent: Some(WebChatSessionIntent::New { cwd: Some(cwd) }),
            ..
        } = input
        else {
            panic!("expected new-session message with workspace");
        };

        assert_eq!(cwd, "/tmp/new-project");
    }

    #[test]
    fn parses_profile_selection() {
        let input = parse_web_chat_input(
            "chat-1",
            r#"{"type":"message","text":"hello","agent":"claude","profileId":"deepseek"}"#,
        )
        .expect("message input");

        let WebChatInput::Message {
            profile: Some(profile),
            ..
        } = input
        else {
            panic!("expected profile message");
        };

        assert_eq!(profile, "deepseek");
    }
}
