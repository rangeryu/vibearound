use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use super::ProxyProtocol;

#[derive(Debug, Clone)]
pub(super) struct ProxySessionMetadata {
    pub(super) profile_id: String,
    pub(super) provider: String,
    pub(super) launch_id: Option<String>,
    pub(super) route_scope: Option<String>,
    pub(super) manual_scope: Option<String>,
    pub(super) agent: Option<String>,
    pub(super) workspace: Option<String>,
    pub(super) client_protocol: ProxyProtocol,
    pub(super) upstream_protocol: ProxyProtocol,
}

#[derive(Debug, Clone)]
pub(super) struct ProxySessionLedger {
    fake_session_id: String,
    turn_id: String,
    path: PathBuf,
    metadata: ProxySessionMetadata,
}

#[derive(Debug)]
pub(super) struct PreparedAgentRequest {
    pub(super) ledger: ProxySessionLedger,
    pub(super) request: Value,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseIndex {
    #[serde(default)]
    schema_version: u64,
    #[serde(default)]
    responses: BTreeMap<String, ResponseIndexEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseIndexEntry {
    fake_session_id: String,
    turn_id: String,
    profile_id: String,
    provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace: Option<String>,
}

impl ProxySessionLedger {
    pub(super) fn prepare(
        mut metadata: ProxySessionMetadata,
        original_request: Value,
        expand_previous_response: bool,
    ) -> Result<PreparedAgentRequest, String> {
        metadata.hydrate_from_launch_metadata();
        let previous_response_id = previous_response_id(&original_request);
        let agent_raw_request = original_request.clone();
        let mut request = original_request;
        let fake_session_id = if expand_previous_response {
            match previous_response_id.as_deref() {
                Some(response_id) => {
                    let index = read_response_index()?;
                    let entry = index.responses.get(response_id).ok_or_else(|| {
                        format!(
                            "unknown previous_response_id '{response_id}' for local proxy session"
                        )
                    })?;
                    request = expand_openai_responses_request(
                        &entry.fake_session_id,
                        &entry.turn_id,
                        request,
                    )?;
                    entry.fake_session_id.clone()
                }
                None => new_fake_session_id(),
            }
        } else {
            previous_response_id
                .as_deref()
                .and_then(|response_id| {
                    read_response_index()
                        .ok()
                        .and_then(|index| index.responses.get(response_id).cloned())
                        .map(|entry| entry.fake_session_id)
                })
                .unwrap_or_else(new_fake_session_id)
        };

        let path = session_path(&fake_session_id);
        let ledger = ProxySessionLedger {
            fake_session_id,
            turn_id: new_turn_id(),
            path,
            metadata,
        };
        ledger.ensure_meta()?;
        ledger.append_agent_request(&agent_raw_request)?;
        Ok(PreparedAgentRequest { ledger, request })
    }

    pub(super) fn response_id(&self) -> String {
        format!(
            "resp_va_{}",
            self.turn_id.strip_prefix("turn_").unwrap_or(&self.turn_id)
        )
    }

    pub(super) fn append_upstream_request(&self, raw: &Value) -> Result<(), String> {
        self.append_line(json!({
            "schemaVersion": 1,
            "kind": "upstream_request",
            "createdAt": now(),
            "fakeSessionId": self.fake_session_id,
            "turnId": self.turn_id,
            "protocol": self.metadata.upstream_protocol.api_type(),
            "apiType": self.metadata.upstream_protocol.api_type(),
            "raw": raw,
        }))
    }

    pub(super) fn append_upstream_response(&self, status: u16, raw: &Value) -> Result<(), String> {
        self.append_line(json!({
            "schemaVersion": 1,
            "kind": "upstream_response",
            "createdAt": now(),
            "fakeSessionId": self.fake_session_id,
            "turnId": self.turn_id,
            "protocol": self.metadata.upstream_protocol.api_type(),
            "apiType": self.metadata.upstream_protocol.api_type(),
            "status": status,
            "raw": raw,
        }))
    }

    pub(super) fn append_upstream_stream_event(&self, raw: &Value) -> Result<(), String> {
        self.append_line(json!({
            "schemaVersion": 1,
            "kind": "upstream_stream_event",
            "createdAt": now(),
            "fakeSessionId": self.fake_session_id,
            "turnId": self.turn_id,
            "protocol": self.metadata.upstream_protocol.api_type(),
            "apiType": self.metadata.upstream_protocol.api_type(),
            "raw": raw,
        }))
    }

    pub(super) fn append_agent_response(&self, status: u16, raw: &Value) -> Result<(), String> {
        let response_id =
            response_id_from_agent_response(raw).unwrap_or_else(|| self.response_id());
        self.append_line(json!({
            "schemaVersion": 1,
            "kind": "agent_response",
            "createdAt": now(),
            "fakeSessionId": self.fake_session_id,
            "turnId": self.turn_id,
            "protocol": self.metadata.client_protocol.api_type(),
            "apiType": self.metadata.client_protocol.api_type(),
            "status": status,
            "responseId": response_id,
            "raw": raw,
        }))?;
        self.index_response_id(&response_id)
    }

    fn append_agent_request(&self, raw: &Value) -> Result<(), String> {
        self.append_line(json!({
            "schemaVersion": 1,
            "kind": "agent_request",
            "createdAt": now(),
            "fakeSessionId": self.fake_session_id,
            "turnId": self.turn_id,
            "protocol": self.metadata.client_protocol.api_type(),
            "apiType": self.metadata.client_protocol.api_type(),
            "raw": raw,
        }))
    }

    fn ensure_meta(&self) -> Result<(), String> {
        ensure_session_dir()?;
        if self.path.exists() && self.path.metadata().map(|meta| meta.len()).unwrap_or(0) > 0 {
            return Ok(());
        }
        self.append_line(json!({
            "schemaVersion": 1,
            "kind": "meta",
            "createdAt": now(),
            "fakeSessionId": self.fake_session_id,
            "profileId": self.metadata.profile_id,
            "provider": self.metadata.provider,
            "launchId": self.metadata.launch_id,
            "routeScope": self.metadata.route_scope,
            "manualScope": self.metadata.manual_scope,
            "agent": self.metadata.agent,
            "workspace": self.metadata.workspace,
            "clientProtocol": self.metadata.client_protocol.api_type(),
            "upstreamProtocol": self.metadata.upstream_protocol.api_type(),
        }))
    }

    fn append_line(&self, line: Value) -> Result<(), String> {
        ensure_session_dir()?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|error| format!("failed to open proxy session ledger: {error}"))?;
        serde_json::to_writer(&mut file, &line)
            .map_err(|error| format!("failed to write proxy session ledger: {error}"))?;
        file.write_all(b"\n")
            .map_err(|error| format!("failed to flush proxy session ledger: {error}"))
    }

    fn index_response_id(&self, response_id: &str) -> Result<(), String> {
        let mut index = read_response_index().unwrap_or_default();
        index.schema_version = 1;
        index.responses.insert(
            response_id.to_string(),
            ResponseIndexEntry {
                fake_session_id: self.fake_session_id.clone(),
                turn_id: self.turn_id.clone(),
                profile_id: self.metadata.profile_id.clone(),
                provider: self.metadata.provider.clone(),
                agent: self.metadata.agent.clone(),
                workspace: self.metadata.workspace.clone(),
            },
        );
        write_response_index(&index)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchMetadata {
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    workspace: Option<String>,
}

impl ProxySessionMetadata {
    fn hydrate_from_launch_metadata(&mut self) {
        if self.agent.is_some() && self.workspace.is_some() {
            return;
        }
        let Some(launch_id) = self.launch_id.as_deref() else {
            return;
        };
        let path = launch_metadata_path(launch_id);
        let Ok(body) = fs::read(&path) else {
            return;
        };
        let Ok(metadata) = serde_json::from_slice::<LaunchMetadata>(&body) else {
            tracing::warn!(
                path = %path.display(),
                "failed to parse proxy launch metadata"
            );
            return;
        };
        if self.agent.is_none() {
            self.agent = metadata.agent;
        }
        if self.workspace.is_none() {
            self.workspace = metadata.workspace;
        }
    }
}

fn expand_openai_responses_request(
    fake_session_id: &str,
    through_turn_id: &str,
    current_request: Value,
) -> Result<Value, String> {
    let path = session_path(fake_session_id);
    let file = File::open(&path)
        .map_err(|error| format!("failed to open proxy session '{fake_session_id}': {error}"))?;
    expand_openai_responses_request_from_reader(
        BufReader::new(file),
        &path.display().to_string(),
        through_turn_id,
        current_request,
    )
}

fn expand_openai_responses_request_from_reader<R: BufRead>(
    reader: R,
    path_label: &str,
    through_turn_id: &str,
    current_request: Value,
) -> Result<Value, String> {
    let mut history = Vec::new();
    let mut saw_target_response = false;

    for line in reader.lines() {
        let Ok(line) = line else {
            continue;
        };
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            tracing::warn!(
                path = %path_label,
                "skipping invalid proxy session jsonl line"
            );
            continue;
        };
        let kind = record.get("kind").and_then(Value::as_str);
        let turn_id = record.get("turnId").and_then(Value::as_str);
        match kind {
            Some("agent_request") => {
                if let Some(raw) = record.get("raw") {
                    append_responses_input(raw, &mut history);
                }
            }
            Some("agent_response") => {
                if let Some(raw) = record.get("raw") {
                    append_responses_output(raw, &mut history);
                }
                if turn_id == Some(through_turn_id) {
                    saw_target_response = true;
                    break;
                }
            }
            _ => {}
        }
    }

    if !saw_target_response {
        return Err(format!(
            "previous_response_id points at incomplete local proxy turn '{through_turn_id}'"
        ));
    }

    append_responses_input(&current_request, &mut history);
    let mut expanded = current_request;
    let object = expanded
        .as_object_mut()
        .ok_or_else(|| "OpenAI Responses request must be a JSON object".to_string())?;
    object.insert("input".to_string(), Value::Array(history));
    object.remove("previous_response_id");
    object.remove("conversation");
    Ok(Value::Object(object.clone()))
}

fn append_responses_input(raw: &Value, history: &mut Vec<Value>) {
    match raw.get("input") {
        Some(Value::String(text)) => history.push(json!({
            "role": "user",
            "content": text,
        })),
        Some(Value::Array(items)) => history.extend(items.iter().cloned()),
        Some(Value::Object(_)) => history.push(raw["input"].clone()),
        _ => {}
    }
}

fn append_responses_output(raw: &Value, history: &mut Vec<Value>) {
    if let Some(items) = raw.get("output").and_then(Value::as_array) {
        history.extend(items.iter().cloned());
    }
}

fn previous_response_id(raw: &Value) -> Option<String> {
    raw.get("previous_response_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn response_id_from_agent_response(raw: &Value) -> Option<String> {
    raw.get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn read_response_index() -> Result<ResponseIndex, String> {
    let path = response_index_path();
    let body = match fs::read_to_string(&path) {
        Ok(body) => body,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ResponseIndex {
                schema_version: 1,
                responses: BTreeMap::new(),
            });
        }
        Err(error) => return Err(format!("failed to read proxy response index: {error}")),
    };
    serde_json::from_str(&body)
        .map_err(|error| format!("failed to parse proxy response index: {error}"))
}

fn write_response_index(index: &ResponseIndex) -> Result<(), String> {
    ensure_base_dir()?;
    let path = response_index_path();
    let body = serde_json::to_vec_pretty(index)
        .map_err(|error| format!("failed to serialize proxy response index: {error}"))?;
    fs::write(path, body).map_err(|error| format!("failed to write proxy response index: {error}"))
}

fn ensure_base_dir() -> Result<(), String> {
    fs::create_dir_all(base_dir())
        .map_err(|error| format!("failed to create proxy session directory: {error}"))
}

fn ensure_session_dir() -> Result<(), String> {
    fs::create_dir_all(session_dir())
        .map_err(|error| format!("failed to create proxy session directory: {error}"))
}

fn base_dir() -> PathBuf {
    common::config::data_dir().join("api-proxy")
}

fn session_dir() -> PathBuf {
    base_dir().join("sessions")
}

fn session_path(fake_session_id: &str) -> PathBuf {
    session_dir().join(format!("{fake_session_id}.jsonl"))
}

fn launch_metadata_path(launch_id: &str) -> PathBuf {
    base_dir()
        .join("launches")
        .join(format!("{launch_id}.json"))
}

fn response_index_path() -> PathBuf {
    base_dir().join("response-index.json")
}

fn new_fake_session_id() -> String {
    format!(
        "vaps_{}_{}",
        Utc::now().timestamp(),
        Uuid::new_v4().simple().to_string()
    )
}

fn new_turn_id() -> String {
    format!("turn_{}", Uuid::new_v4().simple())
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use serde_json::json;

    use super::expand_openai_responses_request_from_reader;

    #[test]
    fn expands_previous_response_context_in_turn_order() {
        let lines = [
            json!({
                "kind": "agent_request",
                "turnId": "turn_1",
                "raw": {
                    "input": "hello"
                }
            }),
            json!({
                "kind": "agent_response",
                "turnId": "turn_1",
                "raw": {
                    "id": "resp_va_1",
                    "output": [{
                        "type": "message",
                        "role": "assistant",
                        "content": [{ "type": "output_text", "text": "hi" }]
                    }]
                }
            }),
            json!({
                "kind": "agent_request",
                "turnId": "turn_2",
                "raw": {
                    "previous_response_id": "resp_va_1",
                    "input": [{
                        "role": "user",
                        "content": "call the tool"
                    }]
                }
            }),
            json!({
                "kind": "agent_response",
                "turnId": "turn_2",
                "raw": {
                    "id": "resp_va_2",
                    "output": [
                        {
                            "type": "reasoning",
                            "id": "rs_1",
                            "content": [{ "type": "reasoning_text", "text": "need tool" }]
                        },
                        {
                            "type": "function_call",
                            "call_id": "call_1",
                            "name": "lookup",
                            "arguments": "{\"q\":\"x\"}"
                        }
                    ]
                }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");

        let current = json!({
            "model": "gpt-test",
            "previous_response_id": "resp_va_2",
            "conversation": "conv_should_not_forward",
            "input": [{
                "type": "function_call_output",
                "call_id": "call_1",
                "output": "tool output"
            }]
        });

        let expanded = expand_openai_responses_request_from_reader(
            Cursor::new(lines),
            "test.jsonl",
            "turn_2",
            current,
        )
        .expect("request expands");

        assert!(expanded.get("previous_response_id").is_none());
        assert!(expanded.get("conversation").is_none());
        let input = expanded["input"].as_array().expect("expanded input array");
        assert_eq!(input.len(), 6);
        assert_eq!(input[0]["role"], "user");
        assert_eq!(input[0]["content"], "hello");
        assert_eq!(input[1]["type"], "message");
        assert_eq!(input[2]["role"], "user");
        assert_eq!(input[3]["type"], "reasoning");
        assert_eq!(input[4]["type"], "function_call");
        assert_eq!(input[5]["type"], "function_call_output");
    }

    #[test]
    fn rejects_incomplete_previous_response_turn() {
        let lines = json!({
            "kind": "agent_request",
            "turnId": "turn_1",
            "raw": { "input": "hello" }
        })
        .to_string();
        let error = expand_openai_responses_request_from_reader(
            Cursor::new(lines),
            "test.jsonl",
            "turn_1",
            json!({ "input": "again" }),
        )
        .unwrap_err();

        assert!(error.contains("incomplete local proxy turn"));
    }
}
