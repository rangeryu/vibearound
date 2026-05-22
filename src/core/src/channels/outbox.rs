//! JSONL-backed channel output outbox.

use std::path::{Path, PathBuf};

use dashmap::DashMap;
use serde::{Deserialize, Serialize};

use crate::routing::ChannelKind;
use crate::storage::jsonl;

use super::ChannelOutput;

const SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum OutboxEvent {
    Enqueued {
        schema_version: u8,
        output_id: String,
        channel_kind: ChannelKind,
        output: ChannelOutput,
    },
    Sent {
        schema_version: u8,
        output_id: String,
    },
    Acked {
        schema_version: u8,
        output_id: String,
    },
    Nacked {
        schema_version: u8,
        output_id: String,
        reason: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct PendingOutput {
    pub output_id: String,
    pub output: ChannelOutput,
}

pub struct ChannelOutbox {
    path: PathBuf,
    pending: DashMap<String, ChannelOutput>,
}

impl ChannelOutbox {
    pub fn new_default() -> Self {
        Self::new(crate::config::data_dir().join("channel-outbox.jsonl"))
    }

    pub fn new(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        let pending = hydrate_pending(&path);
        Self { path, pending }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub async fn enqueue(&self, output: ChannelOutput) -> jsonl::Result<String> {
        let output_id = format!("out_{}", uuid::Uuid::new_v4().simple());
        let channel_kind = output.route_key().channel_kind.clone();
        jsonl::append(
            &self.path,
            &OutboxEvent::Enqueued {
                schema_version: SCHEMA_VERSION,
                output_id: output_id.clone(),
                channel_kind,
                output: output.clone(),
            },
        )
        .await?;
        self.pending.insert(output_id.clone(), output);
        Ok(output_id)
    }

    pub async fn mark_sent(&self, output_id: &str) -> jsonl::Result<()> {
        jsonl::append(
            &self.path,
            &OutboxEvent::Sent {
                schema_version: SCHEMA_VERSION,
                output_id: output_id.to_string(),
            },
        )
        .await?;
        self.pending.remove(output_id);
        Ok(())
    }

    pub async fn mark_nacked(&self, output_id: &str, reason: Option<String>) -> jsonl::Result<()> {
        jsonl::append(
            &self.path,
            &OutboxEvent::Nacked {
                schema_version: SCHEMA_VERSION,
                output_id: output_id.to_string(),
                reason,
            },
        )
        .await?;
        self.pending.remove(output_id);
        Ok(())
    }

    pub fn pending_for_channel(&self, channel_kind: &str) -> Vec<PendingOutput> {
        self.pending
            .iter()
            .filter(|entry| entry.value().route_key().channel_kind == channel_kind)
            .map(|entry| PendingOutput {
                output_id: entry.key().clone(),
                output: entry.value().clone(),
            })
            .collect()
    }
}

fn hydrate_pending(path: &Path) -> DashMap<String, ChannelOutput> {
    let pending = DashMap::new();
    let Ok(file) = std::fs::File::open(path) else {
        return pending;
    };
    let reader = std::io::BufReader::new(file);
    use std::io::BufRead;
    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(event) = serde_json::from_str::<OutboxEvent>(trimmed) else {
            continue;
        };
        match event {
            OutboxEvent::Enqueued {
                output_id, output, ..
            } => {
                pending.insert(output_id, output);
            }
            OutboxEvent::Sent { output_id, .. }
            | OutboxEvent::Acked { output_id, .. }
            | OutboxEvent::Nacked { output_id, .. } => {
                pending.remove(&output_id);
            }
        }
    }
    pending
}

#[cfg(test)]
mod tests {
    use crate::routing::RouteKey;

    use super::*;

    #[tokio::test]
    async fn pending_outputs_filter_by_channel() {
        let path = std::env::temp_dir()
            .join(format!("vibearound-outbox-{}", uuid::Uuid::new_v4()))
            .join("outbox.jsonl");
        let outbox = ChannelOutbox::new(path.clone());
        let feishu = ChannelOutput::SystemText {
            route: RouteKey::new("feishu", "chat-a"),
            text: "hello".to_string(),
            reply_to: None,
        };
        let web = ChannelOutput::SystemText {
            route: RouteKey::new("web", "chat-a"),
            text: "hello".to_string(),
            reply_to: None,
        };

        let feishu_id = outbox.enqueue(feishu).await.unwrap();
        let _ = outbox.enqueue(web).await.unwrap();

        let pending = outbox.pending_for_channel("feishu");

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].output_id, feishu_id);

        let _ = tokio::fs::remove_dir_all(path.parent().unwrap()).await;
    }

    #[tokio::test]
    async fn new_hydrates_unsent_outputs_from_jsonl() {
        let path = std::env::temp_dir()
            .join(format!("vibearound-outbox-{}", uuid::Uuid::new_v4()))
            .join("outbox.jsonl");
        let outbox = ChannelOutbox::new(path.clone());
        let output = ChannelOutput::SystemText {
            route: RouteKey::new("feishu", "chat-a"),
            text: "hello".to_string(),
            reply_to: None,
        };
        let output_id = outbox.enqueue(output).await.unwrap();

        let reloaded = ChannelOutbox::new(path.clone());
        let pending = reloaded.pending_for_channel("feishu");

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].output_id, output_id);

        let _ = tokio::fs::remove_dir_all(path.parent().unwrap()).await;
    }

    #[tokio::test]
    async fn new_ignores_sent_outputs_from_jsonl() {
        let path = std::env::temp_dir()
            .join(format!("vibearound-outbox-{}", uuid::Uuid::new_v4()))
            .join("outbox.jsonl");
        let outbox = ChannelOutbox::new(path.clone());
        let output = ChannelOutput::SystemText {
            route: RouteKey::new("feishu", "chat-a"),
            text: "hello".to_string(),
            reply_to: None,
        };
        let output_id = outbox.enqueue(output).await.unwrap();
        outbox.mark_sent(&output_id).await.unwrap();

        let reloaded = ChannelOutbox::new(path.clone());

        assert!(reloaded.pending_for_channel("feishu").is_empty());

        let _ = tokio::fs::remove_dir_all(path.parent().unwrap()).await;
    }
}
