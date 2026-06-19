use std::collections::BTreeSet;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;

use agent_client_protocol::schema::v1 as acp;
use axum::body::{Body, Bytes};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use bytes::Bytes as ResponseBytes;
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;
use va_ai_api_bridge::{
    ContentBlock as UniversalContentBlock, EncodeState, Extensions, FinishReason, Role,
    UniversalEvent, UniversalItem, UniversalRequest, Usage,
};

use super::completion::translated_completion_events_response;
use super::stream::encode_wire_sse_event;
use super::{json_error, record_json_error, BridgeProtocol};
use crate::web_server::AppState;
use common::agent::AgentClientHandler;

const LOCAL_AGENT_CHANNEL_KIND: &str = "api";
const HEADER_WORKSPACE: &str = "x-vibearound-cwd";

pub async fn local_agent_responses_handler(
    State(state): State<AppState>,
    Path((agent_id, profile_id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    handle_local_agent_request(
        state,
        agent_id,
        profile_id,
        BridgeProtocol::OpenAiResponses,
        headers,
        body,
    )
    .await
}

pub async fn local_agent_chat_completions_handler(
    State(state): State<AppState>,
    Path((agent_id, profile_id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    handle_local_agent_request(
        state,
        agent_id,
        profile_id,
        BridgeProtocol::OpenAiChat,
        headers,
        body,
    )
    .await
}

pub async fn local_agent_messages_handler(
    State(state): State<AppState>,
    Path((agent_id, profile_id)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    handle_local_agent_request(
        state,
        agent_id,
        profile_id,
        BridgeProtocol::AnthropicMessages,
        headers,
        body,
    )
    .await
}

pub async fn local_agent_models_handler(
    Path((agent_id, profile_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let workspace = request_workspace(&headers, &agent_id);
    let models_result = fetch_local_agent_models(&agent_id, &profile_id, &workspace).await;
    let (models, source, warning) = match models_result {
        Ok(models) if !models.is_empty() => (models, "acp", None),
        Ok(_) => (
            fallback_local_agent_models(&agent_id),
            "fallback",
            Some("ACP session did not expose a model selector".to_string()),
        ),
        Err(message) => (
            fallback_local_agent_models(&agent_id),
            "fallback",
            Some(message),
        ),
    };
    local_agent_models_response(agent_id, profile_id, models, source, warning)
}

fn local_agent_models_response(
    agent_id: String,
    profile_id: String,
    models: Vec<LocalAgentModel>,
    source: &str,
    warning: Option<String>,
) -> Response {
    let data: Vec<_> = models
        .into_iter()
        .map(|model| {
            json!({
                "id": model.id,
                "object": "model",
                "type": "model",
                "display_name": model.display_name,
                "owned_by": "vibearound-local-agent",
                "created": 0,
                "created_at": null,
                "agent": agent_id,
                "profile": profile_id,
                "capabilities": {
                    "sessionless": true,
                    "streaming": true,
                }
            })
        })
        .collect();
    Json(json!({
        "object": "list",
        "data": data,
        "has_more": false,
        "source": source,
        "warning": warning,
    }))
    .into_response()
}

async fn fetch_local_agent_models(
    agent_id: &str,
    profile_id: &str,
    workspace: &std::path::Path,
) -> Result<Vec<LocalAgentModel>, String> {
    let agent_id =
        common::resources::resolve_agent_id(agent_id).map_err(|error| error.to_string())?;
    let route = common::routing::RouteKey::new(
        LOCAL_AGENT_CHANNEL_KIND,
        &format!("api_models_{}", Uuid::new_v4().simple()),
    );
    let (extra_args, env_vars) = launch_args_and_env(&agent_id, profile_id, workspace, &route)?;
    let (tx, _rx) = mpsc::unbounded_channel();
    let handler = Arc::new(ApiAgentClientHandler::new(tx));
    let ready = common::agent::Agent::spawn(
        agent_id,
        &route,
        workspace,
        common::agent::StartupSession::Fresh,
        handler,
        extra_args,
        env_vars,
    )
    .await
    .map_err(|error| format!("{error:#}"))?;
    let agent = ready.agent;
    let result = async {
        let session = agent
            .new_session(acp::NewSessionRequest::new(workspace.to_path_buf()))
            .await?;
        Ok::<_, acp::Error>(models_from_acp_config_options(
            session.config_options.as_deref().unwrap_or_default(),
        ))
    }
    .await;
    agent.shutdown().await;
    result.map_err(|error| error.message.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LocalAgentModel {
    id: String,
    display_name: String,
}

impl LocalAgentModel {
    fn new(id: impl Into<String>, display_name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            display_name: display_name.into(),
        }
    }
}

fn fallback_local_agent_models(agent_id: &str) -> Vec<LocalAgentModel> {
    let id = local_agent_fallback_model_id(agent_id);
    vec![LocalAgentModel::new(id.clone(), id)]
}

fn local_agent_fallback_model_id(agent_id: &str) -> String {
    local_agent_model_id_part(agent_id)
}

fn local_agent_model_id_part(value: &str) -> String {
    let mut output = String::new();
    let mut last_was_separator = false;
    for ch in value.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
            last_was_separator = false;
        } else if !last_was_separator {
            output.push('-');
            last_was_separator = true;
        }
    }
    let trimmed = output.trim_matches('-');
    if trimmed.is_empty() {
        "local".to_string()
    } else {
        trimmed.to_string()
    }
}

fn models_from_acp_config_options(options: &[acp::SessionConfigOption]) -> Vec<LocalAgentModel> {
    let mut seen = BTreeSet::new();
    let mut models = Vec::new();
    for option in options {
        if !is_model_config_option(option) {
            continue;
        }
        let acp::SessionConfigKind::Select(select) = &option.kind else {
            continue;
        };
        collect_acp_select_models(&select.options, &mut seen, &mut models);
        push_acp_model(
            &mut seen,
            &mut models,
            select.current_value.to_string(),
            select.current_value.to_string(),
        );
    }
    models
}

fn is_model_config_option(option: &acp::SessionConfigOption) -> bool {
    matches!(
        option.category,
        Some(acp::SessionConfigOptionCategory::Model)
    ) || option.id.to_string().eq_ignore_ascii_case("model")
        || option.name.eq_ignore_ascii_case("model")
}

fn collect_acp_select_models(
    options: &acp::SessionConfigSelectOptions,
    seen: &mut BTreeSet<String>,
    models: &mut Vec<LocalAgentModel>,
) {
    match options {
        acp::SessionConfigSelectOptions::Ungrouped(options) => {
            for option in options {
                push_acp_model(seen, models, option.value.to_string(), option.name.clone());
            }
        }
        acp::SessionConfigSelectOptions::Grouped(groups) => {
            for group in groups {
                for option in &group.options {
                    push_acp_model(seen, models, option.value.to_string(), option.name.clone());
                }
            }
        }
        _ => {}
    }
}

fn push_acp_model(
    seen: &mut BTreeSet<String>,
    models: &mut Vec<LocalAgentModel>,
    id: String,
    display_name: String,
) {
    let id = id.trim().to_string();
    if id.is_empty() || !seen.insert(id.clone()) {
        return;
    }
    let display_name = display_name.trim();
    models.push(LocalAgentModel::new(
        id.clone(),
        if display_name.is_empty() {
            id
        } else {
            display_name.to_string()
        },
    ));
}

async fn handle_local_agent_request(
    _state: AppState,
    agent_id: String,
    profile_id: String,
    protocol: BridgeProtocol,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let raw = match serde_json::from_slice::<Value>(&body) {
        Ok(value) => value,
        Err(error) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                &format!("invalid JSON request body: {error}"),
            );
        }
    };
    let request = match protocol.decode_agent_request(raw) {
        Ok(request) => request,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, &error.to_string()),
    };
    if let Err(message) = validate_sessionless_request(&request, protocol) {
        return json_error(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }
    let prompt = match universal_request_to_acp_prompt(&request) {
        Ok(prompt) => prompt,
        Err(message) => return json_error(StatusCode::UNPROCESSABLE_ENTITY, &message),
    };
    let model = request
        .model
        .clone()
        .filter(|model| !model.trim().is_empty())
        .unwrap_or_else(|| agent_id.clone());
    let workspace = request_workspace(&headers, &agent_id);
    let turn = LocalAgentTurn {
        agent_id,
        profile_id,
        model,
        workspace,
        prompt,
    };

    if request.stream {
        local_agent_stream_response(turn, protocol)
    } else {
        local_agent_completion_response(turn, protocol).await
    }
}

async fn local_agent_completion_response(
    turn: LocalAgentTurn,
    protocol: BridgeProtocol,
) -> Response {
    let (_tx, mut rx, run) = start_local_agent_turn(turn);
    tokio::spawn(run);
    let mut events = Vec::new();
    let mut failed = None;
    while let Some(item) = rx.recv().await {
        match item {
            LocalAgentTurnEvent::Events(mut next) => events.append(&mut next),
            LocalAgentTurnEvent::Failed(message) => failed = Some(message),
            LocalAgentTurnEvent::Done => break,
        }
    }
    if let Some(message) = failed {
        return record_json_error(None, StatusCode::BAD_GATEWAY, &message);
    }
    translated_completion_events_response(events, protocol, None, None)
}

fn local_agent_stream_response(turn: LocalAgentTurn, protocol: BridgeProtocol) -> Response {
    let (_tx, rx, run) = start_local_agent_turn(turn);
    tokio::spawn(run);
    let stream = futures_util::stream::unfold(
        (rx, EncodeState::default(), protocol),
        |(mut rx, mut encode_state, protocol)| async move {
            loop {
                let item = rx.recv().await?;
                match item {
                    LocalAgentTurnEvent::Events(events) => {
                        let wire_events =
                            match protocol.encode_agent_events(&events, &mut encode_state) {
                                Ok(events) => events,
                                Err(error) => {
                                    return Some((
                                        Err(io::Error::new(
                                            io::ErrorKind::InvalidData,
                                            error.to_string(),
                                        )),
                                        (rx, encode_state, protocol),
                                    ));
                                }
                            };
                        let body = wire_events
                            .into_iter()
                            .map(encode_wire_sse_event)
                            .collect::<String>();
                        if body.is_empty() {
                            continue;
                        }
                        return Some((Ok(ResponseBytes::from(body)), (rx, encode_state, protocol)));
                    }
                    LocalAgentTurnEvent::Failed(message) => {
                        let event = UniversalEvent::Error { message, raw: None };
                        let body = protocol
                            .encode_agent_events(&[event], &mut encode_state)
                            .map(|events| {
                                events
                                    .into_iter()
                                    .map(encode_wire_sse_event)
                                    .collect::<String>()
                            })
                            .map_err(|error| {
                                io::Error::new(io::ErrorKind::InvalidData, error.to_string())
                            });
                        return Some((body.map(ResponseBytes::from), (rx, encode_state, protocol)));
                    }
                    LocalAgentTurnEvent::Done => return None,
                }
            }
        },
    );

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| {
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to build local agent stream response",
            )
        })
}

fn start_local_agent_turn(
    turn: LocalAgentTurn,
) -> (
    mpsc::UnboundedSender<LocalAgentTurnEvent>,
    mpsc::UnboundedReceiver<LocalAgentTurnEvent>,
    impl std::future::Future<Output = ()> + Send + 'static,
) {
    let (tx, rx) = mpsc::unbounded_channel();
    let handler = Arc::new(ApiAgentClientHandler::new(tx.clone()));
    let run_tx = tx.clone();
    let run = async move {
        let result = run_local_agent_turn(turn, Arc::clone(&handler), run_tx.clone()).await;
        if let Err(message) = result {
            let _ = run_tx.send(LocalAgentTurnEvent::Failed(message));
        }
        let _ = run_tx.send(LocalAgentTurnEvent::Done);
    };
    (tx, rx, run)
}

async fn run_local_agent_turn(
    turn: LocalAgentTurn,
    handler: Arc<ApiAgentClientHandler>,
    tx: mpsc::UnboundedSender<LocalAgentTurnEvent>,
) -> Result<(), String> {
    let response_id = format!("resp_{}", Uuid::new_v4().simple());
    let message_id = format!("msg_{}", Uuid::new_v4().simple());
    let route = common::routing::RouteKey::new(
        LOCAL_AGENT_CHANNEL_KIND,
        &format!("api_{}", Uuid::new_v4().simple()),
    );
    send_events(
        &tx,
        vec![
            UniversalEvent::ResponseStart {
                id: Some(response_id),
                model: Some(turn.model.clone()),
                extensions: Extensions::new(),
            },
            UniversalEvent::MessageStart {
                id: message_id,
                role: Role::Assistant,
                extensions: Extensions::new(),
            },
            UniversalEvent::ContentStart {
                index: 0,
                block: UniversalContentBlock::Text {
                    text: String::new(),
                },
            },
        ],
    );

    let agent_id =
        common::resources::resolve_agent_id(&turn.agent_id).map_err(|error| error.to_string())?;
    let (extra_args, env_vars) =
        launch_args_and_env(&agent_id, &turn.profile_id, &turn.workspace, &route)?;
    let ready = common::agent::Agent::spawn(
        agent_id,
        &route,
        &turn.workspace,
        common::agent::StartupSession::Fresh,
        handler.clone(),
        extra_args,
        env_vars,
    )
    .await
    .map_err(|error| format!("{error:#}"))?;
    let agent = ready.agent;
    let result = async {
        let session = agent
            .new_session(acp::NewSessionRequest::new(turn.workspace.clone()))
            .await?;
        agent
            .prompt(acp::PromptRequest::new(session.session_id, turn.prompt))
            .await
    }
    .await;
    let _ = handler.prompt_finished(result.is_ok()).await;
    agent.shutdown().await;
    let response = result.map_err(|error| error.message.to_string())?;
    send_events(
        &tx,
        final_events(
            response.stop_reason,
            response.usage.as_ref().map(acp_usage_to_universal),
        ),
    );
    Ok(())
}

fn launch_args_and_env(
    agent_id: &str,
    profile_id: &str,
    workspace: &std::path::Path,
    route: &common::routing::RouteKey,
) -> Result<(Vec<String>, Vec<(String, String)>), String> {
    let profile_id = common::agent::launch::normalize_launch_profile_id(Some(profile_id));
    let mut env_vars = vec![
        (
            "VIBEAROUND_CHANNEL_KIND".to_string(),
            route.channel_kind.clone(),
        ),
        ("VIBEAROUND_CHAT_ID".to_string(), route.chat_id.clone()),
        ("VIBEAROUND_AGENT_KIND".to_string(), agent_id.to_string()),
        (
            "VIBEAROUND_API_REQUEST_ID".to_string(),
            route.chat_id.clone(),
        ),
    ];
    let mut extra_args = Vec::new();
    if common::agent::launch::profile_uses_vibearound_credentials(&profile_id) {
        let applied = common::agent::launch::materialize_profile_for_agent(
            &profile_id,
            agent_id,
            workspace,
            route,
        )
        .map_err(|error| format!("{error:#}"))?;
        env_vars.extend(applied.env);
        extra_args.extend(applied.command_args);
    }
    common::agent::launch::append_profile_id_env(&mut env_vars, Some(&profile_id));
    let prefs = common::agent_state::read_prefs();
    extra_args.extend(common::agent_state::resolve_agent_acp_args(
        &prefs, agent_id,
    ));
    Ok((extra_args, env_vars))
}

fn send_events(tx: &mpsc::UnboundedSender<LocalAgentTurnEvent>, events: Vec<UniversalEvent>) {
    if !events.is_empty() {
        let _ = tx.send(LocalAgentTurnEvent::Events(events));
    }
}

fn final_events(stop_reason: acp::StopReason, usage: Option<Usage>) -> Vec<UniversalEvent> {
    vec![
        UniversalEvent::ContentDone {
            index: 0,
            final_block: None,
        },
        UniversalEvent::MessageDone {
            finish_reason: Some(stop_reason_to_finish_reason(stop_reason)),
            usage: usage.clone(),
            extensions: Extensions::new(),
        },
        UniversalEvent::ResponseDone {
            usage,
            extensions: Extensions::new(),
        },
    ]
}

fn stop_reason_to_finish_reason(reason: acp::StopReason) -> FinishReason {
    match reason {
        acp::StopReason::EndTurn => FinishReason::Stop,
        acp::StopReason::MaxTokens => FinishReason::Length,
        acp::StopReason::Refusal => FinishReason::ContentFilter,
        acp::StopReason::Cancelled | acp::StopReason::MaxTurnRequests => FinishReason::Error,
        _ => FinishReason::Unknown,
    }
}

fn acp_usage_to_universal(usage: &acp::Usage) -> Usage {
    Usage {
        input_tokens: Some(usage.input_tokens),
        output_tokens: Some(usage.output_tokens),
        total_tokens: Some(usage.total_tokens),
    }
}

fn request_workspace(headers: &HeaderMap, agent_id: &str) -> PathBuf {
    headers
        .get(HEADER_WORKSPACE)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| common::config::ensure_loaded().resolve_workspace(agent_id))
}

fn validate_sessionless_request(
    request: &UniversalRequest,
    protocol: BridgeProtocol,
) -> Result<(), String> {
    if protocol == BridgeProtocol::OpenAiResponses
        && source_raw(request)
            .and_then(|raw| raw.get("previous_response_id"))
            .is_some_and(|value| !value.is_null())
    {
        return Err(
            "previous_response_id is not supported by VibeAround local-agent API v1; send the full context in input instead"
                .to_string(),
        );
    }
    Ok(())
}

fn source_raw(request: &UniversalRequest) -> Option<&Value> {
    request
        .source
        .as_ref()
        .and_then(|source| source.raw.as_ref())
}

fn universal_request_to_acp_prompt(
    request: &UniversalRequest,
) -> Result<Vec<acp::ContentBlock>, String> {
    let transcript = universal_request_to_transcript(request);
    if transcript.trim().is_empty() {
        return Err("request does not contain any prompt content".to_string());
    }
    Ok(vec![acp::ContentBlock::Text(acp::TextContent::new(
        transcript,
    ))])
}

fn universal_request_to_transcript(request: &UniversalRequest) -> String {
    let mut sections = Vec::new();
    if !request.instructions.is_empty() {
        sections.push(format!(
            "Instructions:\n{}",
            content_blocks_to_text(&request.instructions)
        ));
    }
    if !request.input.is_empty() {
        let mut conversation = String::new();
        for item in &request.input {
            if !conversation.is_empty() {
                conversation.push_str("\n\n");
            }
            conversation.push_str(&universal_item_to_text(item));
        }
        sections.push(format!("Conversation:\n{conversation}"));
    }
    sections.join("\n\n")
}

fn universal_item_to_text(item: &UniversalItem) -> String {
    match item {
        UniversalItem::Message { role, content, .. } => {
            format!(
                "[{}]\n{}",
                role_label(*role),
                content_blocks_to_text(content)
            )
        }
        UniversalItem::ToolCall {
            id,
            name,
            arguments,
            ..
        } => format!("[tool_call:{id}]\n{name} {arguments}"),
        UniversalItem::ToolResult {
            tool_call_id,
            content,
            is_error,
            ..
        } => format!(
            "[tool_result:{tool_call_id}{}]\n{}",
            if *is_error { ":error" } else { "" },
            content_blocks_to_text(content)
        ),
        UniversalItem::Reasoning { text, .. } => {
            format!(
                "[assistant_reasoning]\n{}",
                text.clone().unwrap_or_default()
            )
        }
        UniversalItem::Unknown { raw } => format!("[unknown]\n{raw}"),
    }
}

fn role_label(role: Role) -> &'static str {
    match role {
        Role::Developer => "developer",
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    }
}

fn content_blocks_to_text(blocks: &[UniversalContentBlock]) -> String {
    blocks
        .iter()
        .map(content_block_to_text)
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn content_block_to_text(block: &UniversalContentBlock) -> String {
    match block {
        UniversalContentBlock::Text { text } => text.clone(),
        UniversalContentBlock::Image {
            media_type,
            url,
            data,
            ..
        } => media_placeholder(
            "image",
            media_type.as_deref(),
            url.as_deref(),
            data.as_deref(),
        ),
        UniversalContentBlock::File {
            media_type,
            filename,
            url,
            data,
            ..
        } => {
            let label = filename.as_deref().unwrap_or("file");
            media_placeholder(
                label,
                media_type.as_deref(),
                url.as_deref(),
                data.as_deref(),
            )
        }
        UniversalContentBlock::ToolCall {
            id,
            name,
            arguments,
            ..
        } => format!("[tool_call:{id}] {name} {arguments}"),
        UniversalContentBlock::ToolResult {
            tool_call_id,
            content,
            is_error,
            ..
        } => format!(
            "[tool_result:{tool_call_id}{}] {}",
            if *is_error { ":error" } else { "" },
            content_blocks_to_text(content)
        ),
        UniversalContentBlock::Reasoning {
            text: Some(text), ..
        } => text.clone(),
        UniversalContentBlock::Reasoning { .. } => String::new(),
        UniversalContentBlock::Unknown { raw } => raw.to_string(),
    }
}

fn media_placeholder(
    kind: &str,
    media_type: Option<&str>,
    url: Option<&str>,
    data: Option<&str>,
) -> String {
    if let Some(url) = url {
        return format!("[{kind}: {}]", url);
    }
    let media = media_type.unwrap_or("unknown");
    if data.is_some_and(|value| !value.is_empty()) {
        format!("[{kind}: embedded {media}]")
    } else {
        format!("[{kind}: {media}]")
    }
}

fn acp_notification_to_events(args: &acp::SessionNotification) -> Vec<UniversalEvent> {
    match &args.update {
        acp::SessionUpdate::AgentMessageChunk(chunk) => acp_content_to_text(&chunk.content)
            .map(|text| vec![UniversalEvent::TextDelta { index: 0, text }])
            .unwrap_or_default(),
        acp::SessionUpdate::AgentThoughtChunk(chunk) => acp_content_to_text(&chunk.content)
            .map(|text| vec![UniversalEvent::ReasoningDelta { index: 1, text }])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn acp_content_to_text(content: &acp::ContentBlock) -> Option<String> {
    match content {
        acp::ContentBlock::Text(text) => Some(text.text.clone()),
        acp::ContentBlock::ResourceLink(link) => Some(format!("[resource: {}]", link.uri)),
        acp::ContentBlock::Image(image) => Some(format!("[image: {}]", image.mime_type)),
        acp::ContentBlock::Audio(audio) => Some(format!("[audio: {}]", audio.mime_type)),
        acp::ContentBlock::Resource(resource) => serde_json::to_string(resource).ok(),
        _ => None,
    }
}

#[derive(Debug)]
struct LocalAgentTurn {
    agent_id: String,
    profile_id: String,
    model: String,
    workspace: PathBuf,
    prompt: Vec<acp::ContentBlock>,
}

enum LocalAgentTurnEvent {
    Events(Vec<UniversalEvent>),
    Failed(String),
    Done,
}

struct ApiAgentClientHandler {
    tx: mpsc::UnboundedSender<LocalAgentTurnEvent>,
    state: Mutex<ApiHandlerState>,
}

#[derive(Default)]
struct ApiHandlerState {
    reasoning_started: bool,
}

impl ApiAgentClientHandler {
    fn new(tx: mpsc::UnboundedSender<LocalAgentTurnEvent>) -> Self {
        Self {
            tx,
            state: Mutex::new(ApiHandlerState::default()),
        }
    }
}

#[async_trait::async_trait]
impl common::agent::AgentClientHandler for ApiAgentClientHandler {
    async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
        let mut events = acp_notification_to_events(&args);
        if events
            .iter()
            .any(|event| matches!(event, UniversalEvent::ReasoningDelta { .. }))
        {
            let mut state = self.state.lock().await;
            if !state.reasoning_started {
                state.reasoning_started = true;
                events.insert(
                    0,
                    UniversalEvent::ContentStart {
                        index: 1,
                        block: UniversalContentBlock::Reasoning {
                            text: None,
                            encrypted: None,
                            extensions: Extensions::new(),
                        },
                    },
                );
            }
        }
        send_events(&self.tx, events);
        Ok(())
    }

    async fn request_permission(
        &self,
        _args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        Ok(acp::RequestPermissionResponse::new(
            acp::RequestPermissionOutcome::Cancelled,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_simple_fallback_local_agent_model_ids() {
        assert_eq!(local_agent_fallback_model_id("claude"), "claude");
        assert_eq!(local_agent_fallback_model_id("codex cli"), "codex-cli");
    }

    #[test]
    fn extracts_models_from_acp_model_config_options() {
        let config = acp::SessionConfigOption::select(
            "model",
            "Model",
            "claude-sonnet-4-6",
            vec![
                acp::SessionConfigSelectOption::new("claude-sonnet-4-6", "Claude Sonnet"),
                acp::SessionConfigSelectOption::new("claude-opus-4-5", "Claude Opus"),
                acp::SessionConfigSelectOption::new("claude-sonnet-4-6", "Duplicate"),
            ],
        )
        .category(acp::SessionConfigOptionCategory::Model);
        let other = acp::SessionConfigOption::select(
            "permission-mode",
            "Permission mode",
            "default",
            vec![acp::SessionConfigSelectOption::new("default", "Default")],
        );

        assert_eq!(
            models_from_acp_config_options(&[other, config]),
            vec![
                LocalAgentModel::new("claude-sonnet-4-6", "Claude Sonnet"),
                LocalAgentModel::new("claude-opus-4-5", "Claude Opus"),
            ]
        );
    }

    #[test]
    fn builds_sessionless_chat_transcript() {
        let request = UniversalRequest {
            instructions: vec![UniversalContentBlock::Text {
                text: "Be concise.".to_string(),
            }],
            input: vec![
                UniversalItem::Message {
                    role: Role::User,
                    id: None,
                    content: vec![UniversalContentBlock::Text {
                        text: "Hello".to_string(),
                    }],
                    extensions: Extensions::new(),
                },
                UniversalItem::Message {
                    role: Role::Assistant,
                    id: None,
                    content: vec![UniversalContentBlock::Text {
                        text: "Hi".to_string(),
                    }],
                    extensions: Extensions::new(),
                },
                UniversalItem::Message {
                    role: Role::User,
                    id: None,
                    content: vec![UniversalContentBlock::Text {
                        text: "Continue".to_string(),
                    }],
                    extensions: Extensions::new(),
                },
            ],
            ..UniversalRequest::default()
        };

        let transcript = universal_request_to_transcript(&request);
        assert!(transcript.contains("Instructions:\nBe concise."));
        assert!(transcript.contains("[user]\nHello"));
        assert!(transcript.contains("[assistant]\nHi"));
        assert!(transcript.contains("[user]\nContinue"));
    }

    #[test]
    fn rejects_previous_response_id_for_sessionless_responses() {
        let request = UniversalRequest {
            source: Some(va_ai_api_bridge::SourcePayload {
                protocol: va_ai_api_bridge::WireProtocol::OpenAiResponses,
                raw: Some(json!({
                    "model": "local",
                    "previous_response_id": "resp_old",
                    "input": "continue"
                })),
            }),
            ..UniversalRequest::default()
        };

        let error =
            validate_sessionless_request(&request, BridgeProtocol::OpenAiResponses).unwrap_err();
        assert!(error.contains("previous_response_id"));
    }

    #[test]
    fn maps_acp_text_notification_to_universal_delta() {
        let notification = acp::SessionNotification::new(
            "session-1".to_string(),
            acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new(acp::ContentBlock::Text(
                acp::TextContent::new("hello"),
            ))),
        );

        let events = acp_notification_to_events(&notification);
        assert_eq!(
            events,
            vec![UniversalEvent::TextDelta {
                index: 0,
                text: "hello".to_string(),
            }]
        );
    }

    #[test]
    fn maps_prompt_response_usage_to_final_events() {
        let usage = Usage {
            input_tokens: Some(2),
            output_tokens: Some(3),
            total_tokens: Some(5),
        };
        let events = final_events(acp::StopReason::EndTurn, Some(usage.clone()));

        assert!(matches!(
            events.get(1),
            Some(UniversalEvent::MessageDone {
                finish_reason: Some(FinishReason::Stop),
                usage: Some(event_usage),
                ..
            }) if event_usage == &usage
        ));
        assert!(matches!(
            events.get(2),
            Some(UniversalEvent::ResponseDone {
                usage: Some(event_usage),
                ..
            }) if event_usage == &usage
        ));
    }
}
