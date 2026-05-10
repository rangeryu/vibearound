use std::collections::{hash_map::DefaultHasher, BTreeSet, HashMap, HashSet};
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::sync::LazyLock;

use common::profiles::schema::DeepSeekProviderSettings;
use dashmap::DashMap;
use serde_json::{json, Map, Value};

use crate::openai_proxy::reasoning_blob::decode_reasoning_content;

use super::{ProviderProxyContext, ProviderRequestSource};

static REASONING_BY_CALL_ID: LazyLock<DashMap<String, String>> = LazyLock::new(DashMap::new);
static REASONING_BY_MESSAGE: LazyLock<DashMap<String, String>> = LazyLock::new(DashMap::new);
const MISSING_REASONING_CONTENT_FALLBACK: &str =
    "Previous DeepSeek reasoning content is unavailable from the local proxy.";
const MISSING_TOOL_OUTPUT_FALLBACK: &str = "Tool output unavailable from the local proxy.";

#[derive(Debug, Default)]
struct ReasoningReplayAccumulator {
    active_reasoning: Option<String>,
    pending_call_ids: Vec<String>,
}

impl ReasoningReplayAccumulator {
    fn reset(&mut self) {
        self.active_reasoning = None;
        self.pending_call_ids.clear();
    }

    fn observe_item(&mut self, scope: &str, item: &Map<String, Value>) -> usize {
        match item.get("type").and_then(Value::as_str) {
            Some("reasoning") => self.observe_reasoning(scope, item),
            Some("function_call") => self.observe_function_call(scope, item),
            Some("function_call_output") => {
                self.reset();
                0
            }
            None | Some("message") => match item.get("role").and_then(Value::as_str) {
                Some("assistant") => self.observe_assistant_message(scope, item),
                _ => {
                    self.reset();
                    0
                }
            },
            _ => {
                self.reset();
                0
            }
        }
    }

    fn observe_reasoning(&mut self, scope: &str, item: &Map<String, Value>) -> usize {
        let Some(reasoning_content) = reasoning_content_from_item(item) else {
            return 0;
        };

        let mut stored_count = 0usize;
        for call_id in self.pending_call_ids.drain(..) {
            store_reasoning(scope, &call_id, &reasoning_content);
            stored_count += 1;
        }
        self.active_reasoning = Some(reasoning_content);
        stored_count
    }

    fn observe_function_call(&mut self, scope: &str, item: &Map<String, Value>) -> usize {
        let Some(call_id) = item
            .get("call_id")
            .or_else(|| item.get("id"))
            .and_then(Value::as_str)
        else {
            return 0;
        };

        if let Some(reasoning_content) = self.active_reasoning.as_deref() {
            store_reasoning(scope, call_id, reasoning_content);
            1
        } else {
            self.pending_call_ids.push(call_id.to_string());
            0
        }
    }

    fn observe_assistant_message(&mut self, scope: &str, item: &Map<String, Value>) -> usize {
        let Some(reasoning_content) = self.active_reasoning.as_deref() else {
            return 0;
        };

        // Codex transcripts may place an empty assistant message between a
        // reasoning item and the following function_call; keep the reasoning
        // active until we see a real assistant message or another boundary.
        if store_reasoning_for_message_item(scope, reasoning_content, item) {
            self.reset();
            1
        } else {
            0
        }
    }
}

#[derive(Debug, Clone)]
pub struct DeepSeekProxyAdapter {
    profile_id: String,
    settings: DeepSeekProviderSettings,
    context: ProviderProxyContext,
    request_source: Option<ProviderRequestSource>,
    stream_reasoning_content: String,
    stream_call_ids: BTreeSet<String>,
}

impl DeepSeekProxyAdapter {
    pub fn new(
        profile_id: String,
        settings: DeepSeekProviderSettings,
        context: ProviderProxyContext,
    ) -> Self {
        Self {
            profile_id,
            settings,
            context,
            request_source: None,
            stream_reasoning_content: String::new(),
            stream_call_ids: BTreeSet::new(),
        }
    }

    pub fn prepare_chat_request(
        &mut self,
        source: ProviderRequestSource,
        original_request: &Value,
        chat_request: &mut Value,
    ) {
        self.request_source = Some(source);
        if source == ProviderRequestSource::AnthropicMessages {
            strip_anthropic_reasoning_content_blocks(chat_request);
        }

        let tool_outputs = self.collect_tool_outputs(original_request, chat_request);
        repair_tool_call_history(&tool_outputs, chat_request);

        if self.should_replay_reasoning_content(source) {
            if let Some(scope) = self.reasoning_scope(source) {
                match source {
                    ProviderRequestSource::OpenAiResponses => {
                        persist_reasoning_from_responses_input(&scope, original_request);
                        if let Some(transcript_path) = self.context.transcript_path.as_deref() {
                            persist_reasoning_from_codex_transcript(&scope, transcript_path);
                        }
                    }
                    ProviderRequestSource::AnthropicMessages => {
                        persist_reasoning_from_anthropic_input(&scope, original_request);
                    }
                    ProviderRequestSource::OpenAiChat => {}
                }
                inject_reasoning_content(&scope, chat_request);
            }
        }

        let Some(request) = chat_request.as_object_mut() else {
            return;
        };

        request.insert(
            "thinking".to_string(),
            json!({
                "type": if self.settings.thinking {
                    "enabled"
                } else {
                    "disabled"
                },
            }),
        );
    }

    pub fn observe_chat_completion(&mut self, completion: &Value) {
        let Some(scope) = self.active_reasoning_scope() else {
            return;
        };
        let Some(message) = completion
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
        else {
            return;
        };
        let Some(reasoning_content) = message.get("reasoning_content").and_then(Value::as_str)
        else {
            return;
        };
        persist_reasoning_for_tool_calls(&scope, reasoning_content, message);
        store_reasoning_for_message(&scope, reasoning_content, message);
    }

    pub fn observe_chat_stream_chunk(&mut self, chunk: &Value) {
        if self.active_reasoning_scope().is_none() {
            return;
        }

        let Some(choices) = chunk.get("choices").and_then(Value::as_array) else {
            return;
        };
        for choice in choices {
            let Some(delta) = choice.get("delta") else {
                continue;
            };
            if let Some(reasoning_delta) = delta.get("reasoning_content").and_then(Value::as_str) {
                self.stream_reasoning_content.push_str(reasoning_delta);
            }
            if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                for (fallback_index, tool_call) in tool_calls.iter().enumerate() {
                    self.observe_tool_call_delta(fallback_index, tool_call);
                }
            }
            if choice.get("finish_reason").and_then(Value::as_str) == Some("tool_calls") {
                self.persist_stream_reasoning();
            }
        }
    }

    fn observe_tool_call_delta(&mut self, _fallback_index: usize, tool_call: &Value) {
        if let Some(call_id) = tool_call.get("id").and_then(Value::as_str) {
            self.stream_call_ids.insert(call_id.to_string());
        }
    }

    fn persist_stream_reasoning(&mut self) {
        if self.stream_reasoning_content.is_empty() || self.stream_call_ids.is_empty() {
            return;
        }
        let Some(scope) = self.active_reasoning_scope() else {
            return;
        };
        for call_id in &self.stream_call_ids {
            store_reasoning(&scope, call_id, &self.stream_reasoning_content);
        }
        self.stream_reasoning_content.clear();
        self.stream_call_ids.clear();
    }

    fn should_replay_reasoning_content(&self, source: ProviderRequestSource) -> bool {
        self.settings.thinking
            && self.settings.replay_reasoning_content
            && source.supports_deepseek_reasoning_replay()
    }

    fn active_reasoning_scope(&self) -> Option<String> {
        let source = self.request_source?;
        if !self.should_replay_reasoning_content(source) {
            return None;
        }
        self.reasoning_scope(source)
    }

    fn reasoning_scope(&self, source: ProviderRequestSource) -> Option<String> {
        reasoning_scope(
            &self.profile_id,
            source,
            self.context.launch_id.as_deref(),
            self.context.session_id.as_deref(),
        )
    }

    fn collect_tool_outputs(
        &self,
        original_request: &Value,
        chat_request: &Value,
    ) -> HashMap<String, String> {
        let mut outputs = HashMap::new();
        if let Some(transcript_path) = self.context.transcript_path.as_deref() {
            collect_tool_outputs_from_codex_transcript(transcript_path, &mut outputs);
        }
        collect_tool_outputs_from_responses_input(original_request, &mut outputs);
        collect_tool_outputs_from_chat_request(chat_request, &mut outputs);
        outputs
    }
}

fn repair_tool_call_history(tool_outputs: &HashMap<String, String>, request: &mut Value) {
    let Some(messages) = request.get_mut("messages").and_then(Value::as_array_mut) else {
        return;
    };

    let original_messages = std::mem::take(messages);
    let mut repaired_messages = Vec::with_capacity(original_messages.len());
    let mut satisfied_tool_call_ids = HashSet::<String>::new();
    let mut index = 0usize;

    while index < original_messages.len() {
        let message = &original_messages[index];
        let tool_call_ids = assistant_tool_call_ids(message);
        if tool_call_ids.is_empty() {
            if is_empty_assistant_message(message) {
                index += 1;
                continue;
            }
            if let Some((tool_call_id, _)) = normalized_tool_message(message, tool_outputs) {
                satisfied_tool_call_ids.insert(tool_call_id);
                index += 1;
                continue;
            }
            repaired_messages.push(message.clone());
            index += 1;
            continue;
        }

        let expected_ids = tool_call_ids.iter().cloned().collect::<HashSet<_>>();
        let mut present_ids = HashSet::<String>::new();
        repaired_messages.push(message.clone());
        index += 1;

        while index < original_messages.len() {
            let next_message = &original_messages[index];
            if is_empty_assistant_message(next_message) {
                index += 1;
                continue;
            }
            let Some((tool_call_id, tool_message)) =
                normalized_tool_message(next_message, tool_outputs)
            else {
                break;
            };

            if expected_ids.contains(&tool_call_id) && present_ids.insert(tool_call_id.clone()) {
                repaired_messages.push(tool_message);
                satisfied_tool_call_ids.insert(tool_call_id);
            }
            index += 1;
        }

        for tool_call_id in tool_call_ids {
            if present_ids.contains(&tool_call_id) {
                continue;
            }
            let content = tool_outputs
                .get(&tool_call_id)
                .map(String::as_str)
                .unwrap_or(MISSING_TOOL_OUTPUT_FALLBACK);
            repaired_messages.push(tool_message_for_call_id(&tool_call_id, content));
            satisfied_tool_call_ids.insert(tool_call_id);
        }

        while index < original_messages.len() {
            let next_message = &original_messages[index];
            if is_empty_assistant_message(next_message) {
                index += 1;
                continue;
            }
            let Some((tool_call_id, _)) = normalized_tool_message(next_message, tool_outputs)
            else {
                break;
            };
            if satisfied_tool_call_ids.contains(&tool_call_id) {
                index += 1;
                continue;
            }
            break;
        }
    }

    *messages = repaired_messages;
}

fn assistant_tool_call_ids(message: &Value) -> Vec<String> {
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return Vec::new();
    }
    let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) else {
        return Vec::new();
    };
    tool_calls
        .iter()
        .filter_map(|tool_call| tool_call.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

fn is_empty_assistant_message(message: &Value) -> bool {
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return false;
    }
    if message.get("tool_calls").is_some() {
        return false;
    }
    if message
        .get("reasoning_content")
        .and_then(Value::as_str)
        .is_some_and(|content| !content.trim().is_empty())
    {
        return false;
    }
    is_empty_content(message.get("content"))
}

fn is_empty_content(content: Option<&Value>) -> bool {
    match content {
        Some(Value::String(content)) => content.trim().is_empty(),
        Some(Value::Array(parts)) => {
            parts.is_empty()
                || parts.iter().all(|part| {
                    part.as_object()
                        .and_then(|part| part.get("text"))
                        .and_then(Value::as_str)
                        .is_some_and(|text| text.trim().is_empty())
                })
        }
        Some(Value::Null) | None => true,
        Some(_) => false,
    }
}

fn normalized_tool_message(
    message: &Value,
    tool_outputs: &HashMap<String, String>,
) -> Option<(String, Value)> {
    let object = message.as_object()?;
    if object.get("role").and_then(Value::as_str) == Some("tool") {
        let tool_call_id = tool_call_id_from_tool_message(object)?;
        let content = object
            .get("content")
            .and_then(value_to_string)
            .or_else(|| tool_outputs.get(tool_call_id).cloned())
            .unwrap_or_default();
        return Some((
            tool_call_id.to_string(),
            tool_message_for_call_id(tool_call_id, &content),
        ));
    }

    if object.get("type").and_then(Value::as_str) == Some("function_call_output") {
        let tool_call_id = call_id_from_function_call_output(object)?;
        return Some((
            tool_call_id.to_string(),
            tool_message_for_call_id(tool_call_id, &tool_output_content(object)),
        ));
    }

    None
}

fn tool_call_id_from_tool_message(message: &Map<String, Value>) -> Option<&str> {
    message
        .get("tool_call_id")
        .or_else(|| message.get("call_id"))
        .or_else(|| message.get("id"))
        .and_then(Value::as_str)
}

fn call_id_from_function_call_output(item: &Map<String, Value>) -> Option<&str> {
    item.get("call_id")
        .or_else(|| item.get("tool_call_id"))
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
}

fn tool_output_content(item: &Map<String, Value>) -> String {
    item.get("output")
        .or_else(|| item.get("content"))
        .and_then(value_to_string)
        .unwrap_or_default()
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(content) => Some(content.clone()),
        Value::Null => Some(String::new()),
        other => serde_json::to_string(other).ok(),
    }
}

fn tool_message_for_call_id(tool_call_id: &str, content: &str) -> Value {
    json!({
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": content,
    })
}

fn collect_tool_outputs_from_responses_input(
    responses_request: &Value,
    outputs: &mut HashMap<String, String>,
) {
    let Some(items) = responses_request.get("input").and_then(Value::as_array) else {
        return;
    };
    for item in items {
        let Some(item) = item.as_object() else {
            continue;
        };
        if item.get("type").and_then(Value::as_str) != Some("function_call_output") {
            continue;
        }
        if let Some(call_id) = call_id_from_function_call_output(item) {
            outputs.insert(call_id.to_string(), tool_output_content(item));
        }
    }
}

fn collect_tool_outputs_from_chat_request(request: &Value, outputs: &mut HashMap<String, String>) {
    let Some(messages) = request.get("messages").and_then(Value::as_array) else {
        return;
    };
    for message in messages {
        let Some(message) = message.as_object() else {
            continue;
        };
        if message.get("role").and_then(Value::as_str) == Some("tool") {
            if let Some(tool_call_id) = tool_call_id_from_tool_message(message) {
                let content = message
                    .get("content")
                    .and_then(value_to_string)
                    .unwrap_or_default();
                outputs.insert(tool_call_id.to_string(), content);
            }
            continue;
        }
        if message.get("type").and_then(Value::as_str) == Some("function_call_output") {
            if let Some(call_id) = call_id_from_function_call_output(message) {
                outputs.insert(call_id.to_string(), tool_output_content(message));
            }
        }
    }
}

fn collect_tool_outputs_from_codex_transcript(
    transcript_path: &str,
    outputs: &mut HashMap<String, String>,
) {
    let Ok(file) = File::open(transcript_path) else {
        tracing::debug!(
            transcript_path = %transcript_path,
            "failed to open Codex transcript for DeepSeek tool output replay"
        );
        return;
    };

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(payload) = entry
            .get("payload")
            .and_then(Value::as_object)
            .filter(|_| entry.get("type").and_then(Value::as_str) == Some("response_item"))
        else {
            continue;
        };
        if payload.get("type").and_then(Value::as_str) != Some("function_call_output") {
            continue;
        }
        if let Some(call_id) = call_id_from_function_call_output(payload) {
            outputs.insert(call_id.to_string(), tool_output_content(payload));
        }
    }
}

fn persist_reasoning_from_codex_transcript(scope: &str, transcript_path: &str) {
    let Ok(file) = File::open(transcript_path) else {
        tracing::debug!(
            transcript_path = %transcript_path,
            "failed to open Codex transcript for DeepSeek reasoning replay"
        );
        return;
    };

    let mut accumulator = ReasoningReplayAccumulator::default();
    let mut stored_count = 0usize;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        stored_count += observe_codex_transcript_entry(scope, &entry, &mut accumulator);
    }

    if stored_count > 0 {
        tracing::debug!(
            transcript_path = %transcript_path,
            stored_count = stored_count,
            "loaded DeepSeek reasoning replay entries from Codex transcript"
        );
    }
}

fn observe_codex_transcript_entry(
    scope: &str,
    entry: &Value,
    accumulator: &mut ReasoningReplayAccumulator,
) -> usize {
    match entry.get("type").and_then(Value::as_str) {
        Some("response_item") => {
            let Some(payload) = entry.get("payload").and_then(Value::as_object) else {
                return 0;
            };
            accumulator.observe_item(scope, payload)
        }
        Some("event_msg") => {
            let event_type = entry
                .get("payload")
                .and_then(|payload| payload.get("type"))
                .and_then(Value::as_str);
            if matches!(
                event_type,
                Some("task_started" | "task_complete" | "user_message")
            ) {
                accumulator.reset();
            }
            0
        }
        Some("turn_context" | "session_meta") => {
            accumulator.reset();
            0
        }
        _ => 0,
    }
}

fn inject_reasoning_content(scope: &str, chat_request: &mut Value) {
    let Some(messages) = chat_request
        .get_mut("messages")
        .and_then(Value::as_array_mut)
    else {
        return;
    };

    for message in messages {
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        if message.get("reasoning_content").is_some() {
            continue;
        }
        let tool_calls = message.get("tool_calls").and_then(Value::as_array);
        let reasoning_content = if let Some(tool_calls) = tool_calls {
            tool_calls
                .iter()
                .filter_map(|tool_call| tool_call.get("id").and_then(Value::as_str))
                .find_map(|call_id| lookup_reasoning(scope, call_id))
                .unwrap_or_else(|| MISSING_REASONING_CONTENT_FALLBACK.to_string())
        } else {
            let Some(reasoning_content) = lookup_reasoning_for_message(scope, message) else {
                continue;
            };
            reasoning_content
        };
        if let Some(obj) = message.as_object_mut() {
            obj.insert(
                "reasoning_content".to_string(),
                Value::String(reasoning_content),
            );
        }
    }
}

fn persist_reasoning_from_responses_input(scope: &str, responses_request: &Value) {
    let Some(items) = responses_request.get("input").and_then(Value::as_array) else {
        return;
    };

    let mut accumulator = ReasoningReplayAccumulator::default();

    for item in items {
        let Some(obj) = item.as_object() else {
            accumulator.reset();
            continue;
        };
        accumulator.observe_item(scope, obj);
    }
}

fn persist_reasoning_from_anthropic_input(scope: &str, anthropic_request: &Value) {
    let Some(messages) = anthropic_request.get("messages").and_then(Value::as_array) else {
        return;
    };

    for message in messages {
        let Some(message) = message.as_object() else {
            continue;
        };
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        persist_reasoning_from_anthropic_assistant_message(scope, message);
    }
}

fn persist_reasoning_from_anthropic_assistant_message(
    scope: &str,
    message: &Map<String, Value>,
) -> usize {
    let Some(blocks) = message.get("content").and_then(Value::as_array) else {
        return 0;
    };

    let mut active_reasoning: Option<String> = None;
    let mut text_parts = Vec::new();
    let mut stored_count = 0usize;

    for block in blocks {
        let Some(block) = block.as_object() else {
            continue;
        };
        match block.get("type").and_then(Value::as_str) {
            Some("thinking" | "redacted_thinking") => {
                active_reasoning = anthropic_reasoning_content_from_block(block);
            }
            Some("tool_use") => {
                if let (Some(reasoning_content), Some(call_id)) = (
                    active_reasoning.as_deref(),
                    block.get("id").and_then(Value::as_str),
                ) {
                    store_reasoning(scope, call_id, reasoning_content);
                    stored_count += 1;
                }
            }
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    text_parts.push(text);
                }
            }
            _ => {}
        }
    }

    if let Some(reasoning_content) = active_reasoning.as_deref() {
        let text = text_parts.join("");
        if !text.is_empty() {
            let mut message = Map::new();
            message.insert("content".to_string(), Value::String(text));
            if store_reasoning_for_message_item(scope, reasoning_content, &message) {
                stored_count += 1;
            }
        }
    }

    stored_count
}

fn anthropic_reasoning_content_from_block(block: &Map<String, Value>) -> Option<String> {
    block
        .get("thinking")
        .or_else(|| block.get("text"))
        .and_then(Value::as_str)
        .filter(|content| !content.is_empty())
        .map(str::to_string)
}

fn reasoning_content_from_item(item: &Map<String, Value>) -> Option<String> {
    if let Some(reasoning_content) = item
        .get("encrypted_content")
        .and_then(Value::as_str)
        .and_then(decode_reasoning_content)
        .filter(|content| !content.is_empty())
    {
        return Some(reasoning_content);
    }

    let content = item.get("content").and_then(Value::as_array)?;
    let text = content
        .iter()
        .filter_map(|part| {
            let part = part.as_object()?;
            if part.get("type").and_then(Value::as_str) != Some("reasoning_text") {
                return None;
            }
            part.get("text").and_then(Value::as_str)
        })
        .collect::<Vec<_>>()
        .join("");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn persist_reasoning_for_tool_calls(scope: &str, reasoning_content: &str, message: &Value) {
    if reasoning_content.is_empty() {
        return;
    }
    let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) else {
        return;
    };
    for tool_call in tool_calls {
        if let Some(call_id) = tool_call.get("id").and_then(Value::as_str) {
            store_reasoning(scope, call_id, reasoning_content);
        }
    }
}

fn store_reasoning_for_message_item(
    scope: &str,
    reasoning_content: &str,
    message: &Map<String, Value>,
) -> bool {
    if reasoning_content.is_empty() {
        return false;
    }
    let Some(content_fingerprint) = message_content_fingerprint(message.get("content")) else {
        return false;
    };
    REASONING_BY_MESSAGE.insert(
        reasoning_message_key(scope, &content_fingerprint),
        reasoning_content.to_string(),
    );
    true
}

fn store_reasoning_for_message(scope: &str, reasoning_content: &str, message: &Value) -> bool {
    let Some(message) = message.as_object() else {
        return false;
    };
    store_reasoning_for_message_item(scope, reasoning_content, message)
}

fn lookup_reasoning_for_message(scope: &str, message: &Value) -> Option<String> {
    let content_fingerprint = message_content_fingerprint(message.get("content"))?;
    REASONING_BY_MESSAGE
        .get(&reasoning_message_key(scope, &content_fingerprint))
        .map(|entry| entry.value().clone())
}

fn message_content_fingerprint(content: Option<&Value>) -> Option<String> {
    let text = match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        Some(Value::Null) | None => String::new(),
        Some(other) => serde_json::to_string(other).unwrap_or_default(),
    };
    if text.is_empty() {
        None
    } else {
        Some(message_text_fingerprint(&text))
    }
}

fn message_text_fingerprint(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{}:{:016x}", text.len(), hasher.finish())
}

fn store_reasoning(scope: &str, call_id: &str, reasoning_content: &str) {
    if reasoning_content.is_empty() {
        return;
    }
    REASONING_BY_CALL_ID.insert(reasoning_key(scope, call_id), reasoning_content.to_string());
}

fn lookup_reasoning(scope: &str, call_id: &str) -> Option<String> {
    REASONING_BY_CALL_ID
        .get(&reasoning_key(scope, call_id))
        .map(|entry| entry.value().clone())
}

fn reasoning_key(scope: &str, call_id: &str) -> String {
    format!("{scope}:{call_id}")
}

fn reasoning_message_key(scope: &str, content_fingerprint: &str) -> String {
    format!("{scope}:message:{content_fingerprint}")
}

fn reasoning_scope(
    profile_id: &str,
    source: ProviderRequestSource,
    launch_id: Option<&str>,
    session_id: Option<&str>,
) -> Option<String> {
    let source = source.replay_scope_key();
    if let Some(session_id) = session_id {
        return Some(format!(
            "profile:{profile_id}:source:{source}:session:{session_id}"
        ));
    }
    if let Some(launch_id) = launch_id {
        return Some(format!(
            "profile:{profile_id}:source:{source}:launch:{launch_id}"
        ));
    }
    None
}

fn strip_anthropic_reasoning_content_blocks(chat_request: &mut Value) {
    let Some(messages) = chat_request
        .get_mut("messages")
        .and_then(Value::as_array_mut)
    else {
        return;
    };

    for message in messages {
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(parts) = message.get_mut("content").and_then(Value::as_array_mut) else {
            continue;
        };
        parts.retain(|part| !is_anthropic_reasoning_content_part(part));
    }
}

fn is_anthropic_reasoning_content_part(part: &Value) -> bool {
    part.get("type").and_then(Value::as_str) == Some("unknown")
        && part
            .get("raw")
            .and_then(|raw| raw.get("type"))
            .and_then(Value::as_str)
            == Some("reasoning")
}

pub(super) fn clear_reasoning_for_context(
    profile_id: &str,
    launch_id: Option<&str>,
    session_id: Option<&str>,
) {
    for source in ProviderRequestSource::deepseek_replay_sources() {
        if let Some(scope) = reasoning_scope(profile_id, source, None, session_id) {
            clear_reasoning_scope(&scope);
        }
        if let Some(scope) = reasoning_scope(profile_id, source, launch_id, None) {
            clear_reasoning_scope(&scope);
        }
    }
}

fn clear_reasoning_scope(scope: &str) {
    let prefix = format!("{scope}:");
    REASONING_BY_CALL_ID.retain(|key, _| !key.starts_with(&prefix));
    REASONING_BY_MESSAGE.retain(|key, _| !key.starts_with(&prefix));
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use common::profiles::schema::DeepSeekProviderSettings;
    use serde_json::json;

    use crate::openai_proxy::providers::{ProviderProxyContext, ProviderRequestSource};
    use crate::openai_proxy::reasoning_blob::encode_reasoning_content;

    use super::DeepSeekProxyAdapter;

    #[test]
    fn default_settings_disable_thinking_for_existing_profiles() {
        let mut adapter = new_adapter("deepseek-profile", DeepSeekProviderSettings::default());
        let mut request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{ "role": "user", "content": "hello" }],
        });

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({ "input": "hello" }),
            &mut request,
        );

        assert_eq!(request["thinking"]["type"], "disabled");
    }

    #[test]
    fn replays_reasoning_content_for_matching_tool_call() {
        let settings = thinking_settings();
        let mut adapter = new_adapter("deepseek-replay", settings.clone());
        let mut first_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{ "role": "user", "content": "hello" }]
        });
        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({ "input": [] }),
            &mut first_request,
        );
        adapter.observe_chat_stream_chunk(&json!({
            "choices": [{
                "delta": { "reasoning_content": "I should inspect cwd." },
                "finish_reason": null
            }]
        }));
        adapter.observe_chat_stream_chunk(&json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_pwd",
                        "type": "function",
                        "function": { "name": "exec_command", "arguments": "{\"cmd\":\"pwd\"}" }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        }));

        let mut next_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_pwd",
                    "type": "function",
                    "function": { "name": "exec_command", "arguments": "{\"cmd\":\"pwd\"}" }
                }]
            }, {
                "role": "tool",
                "tool_call_id": "call_pwd",
                "content": "/Users/jazzen/Development"
            }]
        });
        let mut adapter = new_adapter("deepseek-replay", settings);

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({ "input": [] }),
            &mut next_request,
        );

        assert_eq!(next_request["thinking"]["type"], "enabled");
        assert_eq!(
            next_request["messages"][0]["reasoning_content"],
            "I should inspect cwd."
        );
    }

    #[test]
    fn replays_reasoning_content_from_responses_history() {
        let settings = thinking_settings();
        let original_request = json!({
            "input": [
                {
                    "type": "reasoning",
                    "id": "rs_1",
                    "summary": [],
                    "encrypted_content": encode_reasoning_content("Call pwd, then answer.")
                },
                {
                    "type": "function_call",
                    "call_id": "call_pwd",
                    "name": "exec_command",
                    "arguments": "{\"cmd\":\"pwd\"}"
                },
                {
                    "type": "function_call_output",
                    "call_id": "call_pwd",
                    "output": "/Users/jazzen/Development"
                }
            ]
        });
        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_pwd",
                    "type": "function",
                    "function": { "name": "exec_command", "arguments": "{\"cmd\":\"pwd\"}" }
                }]
            }, {
                "role": "tool",
                "tool_call_id": "call_pwd",
                "content": "/Users/jazzen/Development"
            }]
        });
        let mut adapter = new_adapter("deepseek-history", settings);

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &original_request,
            &mut chat_request,
        );

        assert_eq!(
            chat_request["messages"][0]["reasoning_content"],
            "Call pwd, then answer."
        );
    }

    #[test]
    fn replays_reasoning_content_from_codex_transcript() {
        let settings = thinking_settings();
        let transcript_path = unique_transcript_path();
        let transcript_lines = [
            json!({
                "timestamp": "2026-05-02T07:45:11.817Z",
                "type": "response_item",
                "payload": {
                    "type": "reasoning",
                    "summary": [],
                    "content": null,
                    "encrypted_content": encode_reasoning_content("The user asked for files, so list the directory.")
                }
            }),
            json!({
                "timestamp": "2026-05-02T07:45:11.817Z",
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": "" }]
                }
            }),
            json!({
                "timestamp": "2026-05-02T07:45:11.818Z",
                "type": "response_item",
                "payload": {
                    "type": "function_call",
                    "name": "exec_command",
                    "arguments": "{\"cmd\":\"ls\"}",
                    "call_id": "call_from_transcript"
                }
            }),
            json!({
                "timestamp": "2026-05-02T07:45:11.928Z",
                "type": "response_item",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "call_from_transcript",
                    "output": "Cargo.toml"
                }
            }),
            json!({
                "timestamp": "2026-05-02T07:45:12.140Z",
                "type": "response_item",
                "payload": {
                    "type": "reasoning",
                    "summary": [],
                    "content": null,
                    "encrypted_content": encode_reasoning_content("The directory result is in, so answer the user.")
                }
            }),
            json!({
                "timestamp": "2026-05-02T07:45:16.420Z",
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": "Here are the files." }]
                }
            }),
        ];
        let transcript = transcript_lines
            .into_iter()
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&transcript_path, transcript).unwrap();

        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_from_transcript",
                    "type": "function",
                    "function": { "name": "exec_command", "arguments": "{\"cmd\":\"ls\"}" }
                }]
            }, {
                "role": "tool",
                "tool_call_id": "call_from_transcript",
                "content": "Cargo.toml"
            }, {
                "role": "assistant",
                "content": "Here are the files."
            }]
        });
        let mut adapter = DeepSeekProxyAdapter::new(
            "deepseek-transcript".to_string(),
            settings,
            ProviderProxyContext {
                launch_id: Some("launch-transcript".to_string()),
                session_id: Some("session-transcript".to_string()),
                transcript_path: Some(transcript_path.to_string_lossy().into_owned()),
            },
        );

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({ "input": [] }),
            &mut chat_request,
        );

        fs::remove_file(transcript_path).ok();
        assert_eq!(
            chat_request["messages"][0]["reasoning_content"],
            "The user asked for files, so list the directory."
        );
        assert_eq!(
            chat_request["messages"][2]["reasoning_content"],
            "The directory result is in, so answer the user."
        );
    }

    #[test]
    fn adds_fallback_reasoning_content_for_existing_history() {
        let settings = thinking_settings();
        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_old",
                    "type": "function",
                    "function": { "name": "exec_command", "arguments": "{\"cmd\":\"pwd\"}" }
                }]
            }]
        });
        let mut adapter = new_adapter("deepseek-fallback", settings);

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({ "input": [] }),
            &mut chat_request,
        );

        assert_eq!(
            chat_request["messages"][0]["reasoning_content"],
            super::MISSING_REASONING_CONTENT_FALLBACK
        );
    }

    #[test]
    fn leaves_plain_assistant_history_without_synthetic_reasoning() {
        let settings = thinking_settings();
        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{
                "role": "assistant",
                "content": "I will check the latest docs."
            }, {
                "role": "user",
                "content": "continue"
            }]
        });
        let mut adapter = new_adapter("deepseek-plain-fallback", settings);

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({ "input": [] }),
            &mut chat_request,
        );

        assert!(chat_request["messages"][0]
            .get("reasoning_content")
            .is_none());
        assert!(chat_request["messages"][1]
            .get("reasoning_content")
            .is_none());
    }

    #[test]
    fn does_not_replay_reasoning_content_for_openai_chat_source() {
        let settings = thinking_settings();
        let mut first_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{ "role": "user", "content": "hello" }]
        });
        let mut adapter = new_adapter("deepseek-chat-source", settings.clone());
        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({ "input": [] }),
            &mut first_request,
        );
        adapter.observe_chat_completion(&json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "reasoning_content": "I should inspect cwd.",
                    "tool_calls": [{
                        "id": "call_pwd",
                        "type": "function",
                        "function": { "name": "exec_command", "arguments": "{\"cmd\":\"pwd\"}" }
                    }]
                }
            }]
        }));

        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_pwd",
                    "type": "function",
                    "function": { "name": "exec_command", "arguments": "{\"cmd\":\"pwd\"}" }
                }]
            }]
        });
        let mut adapter = new_adapter("deepseek-chat-source", settings);

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiChat,
            &chat_request.clone(),
            &mut chat_request,
        );

        assert_eq!(chat_request["thinking"]["type"], "enabled");
        assert!(chat_request["messages"][0]
            .get("reasoning_content")
            .is_none());
    }

    #[test]
    fn replays_reasoning_content_from_anthropic_thinking_tool_use() {
        let settings = thinking_settings();
        let original_request = json!({
            "messages": [{
                "role": "assistant",
                "content": [
                    { "type": "thinking", "thinking": "Call pwd, then answer." },
                    {
                        "type": "tool_use",
                        "id": "toolu_pwd",
                        "name": "exec_command",
                        "input": { "cmd": "pwd" }
                    }
                ]
            }, {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "toolu_pwd",
                    "content": "/tmp/project"
                }]
            }]
        });
        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{
                "role": "assistant",
                "content": [{
                    "type": "unknown",
                    "raw": { "type": "reasoning", "text": "Call pwd, then answer." }
                }]
            }, {
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "toolu_pwd",
                    "type": "function",
                    "function": { "name": "exec_command", "arguments": "{\"cmd\":\"pwd\"}" }
                }]
            }, {
                "role": "tool",
                "tool_call_id": "toolu_pwd",
                "content": "/tmp/project"
            }]
        });
        let mut adapter = new_adapter("deepseek-anthropic-tool", settings);

        adapter.prepare_chat_request(
            ProviderRequestSource::AnthropicMessages,
            &original_request,
            &mut chat_request,
        );

        let messages = chat_request["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["reasoning_content"], "Call pwd, then answer.");
        assert_eq!(messages[0]["tool_calls"][0]["id"], "toolu_pwd");
    }

    #[test]
    fn replays_reasoning_content_from_anthropic_thinking_text() {
        let settings = thinking_settings();
        let original_request = json!({
            "messages": [{
                "role": "assistant",
                "content": [
                    { "type": "thinking", "thinking": "Explain briefly." },
                    { "type": "text", "text": "The answer is 42." }
                ]
            }]
        });
        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{
                "role": "assistant",
                "content": [
                    {
                        "type": "unknown",
                        "raw": { "type": "reasoning", "text": "Explain briefly." }
                    },
                    { "type": "text", "text": "The answer is 42." }
                ]
            }]
        });
        let mut adapter = new_adapter("deepseek-anthropic-text", settings);

        adapter.prepare_chat_request(
            ProviderRequestSource::AnthropicMessages,
            &original_request,
            &mut chat_request,
        );

        assert_eq!(
            chat_request["messages"][0]["reasoning_content"],
            "Explain briefly."
        );
        assert_eq!(
            chat_request["messages"][0]["content"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn skips_reasoning_replay_without_launch_or_session_scope() {
        let settings = thinking_settings();
        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_old",
                    "type": "function",
                    "function": { "name": "exec_command", "arguments": "{\"cmd\":\"pwd\"}" }
                }]
            }]
        });
        let mut adapter = DeepSeekProxyAdapter::new(
            "deepseek-no-scope".to_string(),
            settings,
            ProviderProxyContext::default(),
        );

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({ "input": [] }),
            &mut chat_request,
        );

        assert!(chat_request["messages"][0]
            .get("reasoning_content")
            .is_none());
    }

    #[test]
    fn clears_launch_and_session_reasoning_scopes() {
        let settings = thinking_settings();
        let original_request = json!({
            "input": [
                {
                    "type": "reasoning",
                    "encrypted_content": encode_reasoning_content("Launch scoped reasoning.")
                },
                {
                    "type": "function_call",
                    "call_id": "call_launch",
                    "name": "exec_command",
                    "arguments": "{\"cmd\":\"pwd\"}"
                }
            ]
        });
        let mut launch_adapter = DeepSeekProxyAdapter::new(
            "deepseek-clear".to_string(),
            settings.clone(),
            ProviderProxyContext {
                launch_id: Some("launch-clear".to_string()),
                session_id: None,
                transcript_path: None,
            },
        );
        let mut launch_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{ "role": "user", "content": "hello" }]
        });
        launch_adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &original_request,
            &mut launch_request,
        );

        let mut session_adapter = DeepSeekProxyAdapter::new(
            "deepseek-clear".to_string(),
            settings,
            ProviderProxyContext {
                launch_id: Some("launch-clear".to_string()),
                session_id: Some("session-clear".to_string()),
                transcript_path: None,
            },
        );
        let mut session_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{ "role": "user", "content": "hello" }]
        });
        session_adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({
                "input": [
                    {
                        "type": "reasoning",
                        "encrypted_content": encode_reasoning_content("Session scoped reasoning.")
                    },
                    {
                        "type": "function_call",
                        "call_id": "call_session",
                        "name": "exec_command",
                        "arguments": "{\"cmd\":\"pwd\"}"
                    }
                ]
            }),
            &mut session_request,
        );

        super::clear_reasoning_for_context(
            "deepseek-clear",
            Some("launch-clear"),
            Some("session-clear"),
        );

        assert!(super::lookup_reasoning(
            "profile:deepseek-clear:source:openai-responses:launch:launch-clear",
            "call_launch"
        )
        .is_none());
        assert!(super::lookup_reasoning(
            "profile:deepseek-clear:source:openai-responses:session:session-clear",
            "call_session"
        )
        .is_none());
    }

    #[test]
    fn repairs_tool_history_across_empty_assistant_with_real_request_output() {
        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [
                {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_ls",
                        "type": "function",
                        "function": { "name": "exec_command", "arguments": "{\"cmd\":\"ls\"}" }
                    }]
                },
                {
                    "role": "assistant",
                    "content": ""
                },
                {
                    "role": "tool",
                    "tool_call_id": "call_ls",
                    "content": "Cargo.toml\nsrc"
                },
                {
                    "role": "user",
                    "content": "what is here?"
                }
            ]
        });
        let mut adapter = new_adapter("deepseek-tool-request", DeepSeekProviderSettings::default());

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({ "input": [] }),
            &mut chat_request,
        );

        let messages = chat_request["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1]["role"], "tool");
        assert_eq!(messages[1]["tool_call_id"], "call_ls");
        assert_eq!(messages[1]["content"], "Cargo.toml\nsrc");
        assert_ne!(messages[1]["content"], super::MISSING_TOOL_OUTPUT_FALLBACK);
        assert_eq!(messages[2]["role"], "user");
    }

    #[test]
    fn repairs_tool_history_from_responses_input() {
        let original_request = json!({
            "input": [{
                "type": "function_call_output",
                "call_id": "call_pwd",
                "output": "/tmp/project"
            }]
        });
        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [
                {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_pwd",
                        "type": "function",
                        "function": { "name": "exec_command", "arguments": "{\"cmd\":\"pwd\"}" }
                    }]
                },
                {
                    "role": "assistant",
                    "content": ""
                }
            ]
        });
        let mut adapter = new_adapter(
            "deepseek-tool-responses",
            DeepSeekProviderSettings::default(),
        );

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &original_request,
            &mut chat_request,
        );

        assert_eq!(chat_request["messages"][1]["role"], "tool");
        assert_eq!(chat_request["messages"][1]["tool_call_id"], "call_pwd");
        assert_eq!(chat_request["messages"][1]["content"], "/tmp/project");
    }

    #[test]
    fn repairs_tool_history_from_codex_transcript() {
        let transcript_path = unique_transcript_path();
        let transcript = json!({
            "timestamp": "2026-05-05T03:00:00.000Z",
            "type": "response_item",
            "payload": {
                "type": "function_call_output",
                "call_id": "call_date",
                "output": "Tue May  5 03:00:00 CST 2026"
            }
        })
        .to_string();
        fs::write(&transcript_path, transcript).unwrap();

        let mut chat_request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{
                "role": "assistant",
                "content": null,
                "tool_calls": [{
                    "id": "call_date",
                    "type": "function",
                    "function": { "name": "exec_command", "arguments": "{\"cmd\":\"date\"}" }
                }]
            }]
        });
        let mut adapter = DeepSeekProxyAdapter::new(
            "deepseek-tool-transcript".to_string(),
            DeepSeekProviderSettings::default(),
            ProviderProxyContext {
                launch_id: Some("launch-tool-transcript".to_string()),
                session_id: Some("session-tool-transcript".to_string()),
                transcript_path: Some(transcript_path.to_string_lossy().into_owned()),
            },
        );

        adapter.prepare_chat_request(
            ProviderRequestSource::OpenAiResponses,
            &json!({ "input": [] }),
            &mut chat_request,
        );

        fs::remove_file(transcript_path).ok();
        assert_eq!(chat_request["messages"][1]["role"], "tool");
        assert_eq!(chat_request["messages"][1]["tool_call_id"], "call_date");
        assert_eq!(
            chat_request["messages"][1]["content"],
            "Tue May  5 03:00:00 CST 2026"
        );
    }

    fn thinking_settings() -> DeepSeekProviderSettings {
        DeepSeekProviderSettings {
            thinking: true,
            replay_reasoning_content: true,
        }
    }

    fn new_adapter(profile_id: &str, settings: DeepSeekProviderSettings) -> DeepSeekProxyAdapter {
        DeepSeekProxyAdapter::new(
            profile_id.to_string(),
            settings,
            ProviderProxyContext {
                launch_id: Some(format!("launch-{profile_id}")),
                session_id: Some(format!("session-{profile_id}")),
                transcript_path: None,
            },
        )
    }

    fn unique_transcript_path() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "vibearound-deepseek-transcript-{}-{nanos}.jsonl",
            std::process::id()
        ))
    }
}
