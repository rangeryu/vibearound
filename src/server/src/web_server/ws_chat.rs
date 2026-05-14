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

use agent_client_protocol as acp;
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
                        WebChatInput::Message(input) => {
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
    Message(ChannelInput),
    Stop(ChannelInput),
    PermissionResponse {
        request_id: String,
        response: acp::RequestPermissionResponse,
    },
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
                    let agent = v
                        .get("agent")
                        .and_then(|x| x.as_str())
                        .map(str::trim)
                        .filter(|x| !x.is_empty());
                    Some(WebChatInput::Message(ChannelInput::Message {
                        envelope: ChannelEnvelope {
                            route: RouteKey::new("web", chat_id),
                            message_id,
                            turn_id: None,
                            text: text.to_string(),
                            sender_id: "web-user".to_string(),
                            attachments: vec![],
                            parent_id: None,
                            cli_kind: agent.map(ToOwned::to_owned),
                        },
                    }))
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
                Some(WebChatInput::Message(ChannelInput::Message {
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
                }))
            }
        }
    }
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
}
