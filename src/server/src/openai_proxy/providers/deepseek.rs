use std::collections::{hash_map::DefaultHasher, BTreeSet, HashMap, HashSet};
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::sync::LazyLock;

use common::profiles::schema::DeepSeekProviderSettings;
use dashmap::DashMap;
use serde_json::{json, Map, Value};

use crate::openai_proxy::reasoning_blob::decode_reasoning_content;

use super::ProviderProxyContext;

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
            stream_reasoning_content: String::new(),
            stream_call_ids: BTreeSet::new(),
        }
    }

    pub fn prepare_chat_request(&mut self, original_request: &Value, chat_request: &mut Value) {
        let tool_outputs = self.collect_tool_outputs(original_request, chat_request);
        repair_tool_call_history(&tool_outputs, chat_request);

        if self.settings.thinking && self.settings.replay_reasoning_content {
            let scope = self.reasoning_scope();
            persist_reasoning_from_responses_input(&scope, original_request);
            if let Some(transcript_path) = self.context.transcript_path.as_deref() {
                persist_reasoning_from_codex_transcript(&scope, transcript_path);
            }
            inject_reasoning_content(&scope, chat_request);
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
        if !self.settings.thinking || !self.settings.replay_reasoning_content {
            return;
        }
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
        let scope = self.reasoning_scope();
        persist_reasoning_for_tool_calls(&scope, reasoning_content, message);
        store_reasoning_for_message(&scope, reasoning_content, message);
    }

    pub fn observe_chat_stream_chunk(&mut self, chunk: &Value) {
        if !self.settings.thinking || !self.settings.replay_reasoning_content {
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
        let scope = self.reasoning_scope();
        for call_id in &self.stream_call_ids {
            store_reasoning(&scope, call_id, &self.stream_reasoning_content);
        }
        self.stream_reasoning_content.clear();
        self.stream_call_ids.clear();
    }

    fn reasoning_scope(&self) -> String {
        reasoning_scope(
            &self.profile_id,
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
        let reasoning_content = tool_calls
            .and_then(|tool_calls| {
                tool_calls
                    .iter()
                    .filter_map(|tool_call| tool_call.get("id").and_then(Value::as_str))
                    .find_map(|call_id| lookup_reasoning(scope, call_id))
                    .or_else(|| Some(MISSING_REASONING_CONTENT_FALLBACK.to_string()))
            })
            .or_else(|| lookup_reasoning_for_message(scope, message))
            .unwrap_or_else(|| MISSING_REASONING_CONTENT_FALLBACK.to_string());
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

fn reasoning_scope(profile_id: &str, launch_id: Option<&str>, session_id: Option<&str>) -> String {
    if let Some(session_id) = session_id {
        return format!("profile:{profile_id}:session:{session_id}");
    }
    if let Some(launch_id) = launch_id {
        return format!("profile:{profile_id}:launch:{launch_id}");
    }
    format!("profile:{profile_id}")
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use common::profiles::schema::DeepSeekProviderSettings;
    use serde_json::json;

    use crate::openai_proxy::providers::ProviderProxyContext;
    use crate::openai_proxy::reasoning_blob::encode_reasoning_content;

    use super::DeepSeekProxyAdapter;

    #[test]
    fn default_settings_disable_thinking_for_existing_profiles() {
        let mut adapter = new_adapter("deepseek-profile", DeepSeekProviderSettings::default());
        let mut request = json!({
            "model": "deepseek-v4-flash",
            "messages": [{ "role": "user", "content": "hello" }],
        });

        adapter.prepare_chat_request(&json!({ "input": "hello" }), &mut request);

        assert_eq!(request["thinking"]["type"], "disabled");
    }

    #[test]
    fn replays_reasoning_content_for_matching_tool_call() {
        let settings = thinking_settings();
        let mut adapter = new_adapter("deepseek-replay", settings.clone());
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

        adapter.prepare_chat_request(&json!({ "input": [] }), &mut next_request);

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

        adapter.prepare_chat_request(&original_request, &mut chat_request);

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

        adapter.prepare_chat_request(&json!({ "input": [] }), &mut chat_request);

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

        adapter.prepare_chat_request(&json!({ "input": [] }), &mut chat_request);

        assert_eq!(
            chat_request["messages"][0]["reasoning_content"],
            super::MISSING_REASONING_CONTENT_FALLBACK
        );
    }

    #[test]
    fn adds_fallback_reasoning_content_for_plain_assistant_history() {
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

        adapter.prepare_chat_request(&json!({ "input": [] }), &mut chat_request);

        assert_eq!(
            chat_request["messages"][0]["reasoning_content"],
            super::MISSING_REASONING_CONTENT_FALLBACK
        );
        assert!(chat_request["messages"][1]
            .get("reasoning_content")
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

        adapter.prepare_chat_request(&json!({ "input": [] }), &mut chat_request);

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

        adapter.prepare_chat_request(&original_request, &mut chat_request);

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

        adapter.prepare_chat_request(&json!({ "input": [] }), &mut chat_request);

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
            ProviderProxyContext::default(),
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
