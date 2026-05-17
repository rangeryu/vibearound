//! Channel-input dispatch.
//!
//! `handle_channel_input` is the single entry point for every inbound
//! `ChannelInput` from stdio plugins or the web chat. It routes by
//! variant:
//!
//! - `Message` / `Callback` → [`handler::handle_prompt`] (slash
//!   command parse → ConversationManager prompt).
//! - `Stop` / `Close` / `SwitchAgent` → direct `ConversationManager` calls.
//! - `Log` → forward to the daemon log stream.
//!
//! Sub-modules:
//! - [`handler`]   — `handle_prompt` + slash-command dispatch.
//! - [`handover`]  — Direction-2 session export (generate resume command).
//! - [`mode`]      — `/mode <id>` handling.

mod handler;
mod handover;
mod mode;

use std::sync::Arc;

use agent_client_protocol::schema as acp;

use crate::conversations::ConversationManager;
use crate::routing::{Attachment, RouteKey};

use super::plugin_host::PluginHost;
use super::types::{ChannelInput, ChannelOutput};

pub(crate) use handler::handle_prompt;

/// Dispatch a single `ChannelInput` to the right subsystem. Used by both the
/// stdio plugin transport and the legacy web-chat channel-input thread.
pub async fn handle_channel_input(
    conversation_manager: &Arc<ConversationManager>,
    plugin_host: &Arc<PluginHost>,
    input: ChannelInput,
) {
    match input {
        ChannelInput::Message { envelope }
        | ChannelInput::Callback {
            envelope,
            action_value: _,
        } => {
            let route = envelope.route.clone();
            let cli_kind = envelope.cli_kind.clone();
            let text = envelope.text.clone();
            let message_id = if envelope.message_id.is_empty() {
                None
            } else {
                Some(envelope.message_id.clone())
            };
            tracing::debug!(
                route = %route,
                cli_kind = ?cli_kind,
                text = %text,
                "channel input"
            );

            let content_blocks = envelope_content_blocks(&text, &envelope.attachments);

            match handle_prompt(
                conversation_manager,
                plugin_host,
                route.clone(),
                cli_kind,
                content_blocks,
            )
            .await
            {
                Ok(_resp) => {
                    tracing::debug!(route = %route, "prompt ok");
                }
                Err(e) => {
                    tracing::warn!(route = %route, error = %e, "prompt failed");
                    send_system_text(plugin_host, &route, &format!("❌ {}", e)).await;
                }
            }
            send_prompt_done(plugin_host, &route, message_id).await;
        }
        ChannelInput::Stop { route } => {
            let _ = conversation_manager.cancel(&route).await;
        }
        ChannelInput::Close { route, reason } => {
            conversation_manager.close(&route, reason).await;
        }
        ChannelInput::SwitchAgent { route, agent_kind } => {
            if let Err(e) = conversation_manager.switch_agent(&route, agent_kind).await {
                tracing::warn!(route = %route, error = %e, "switch agent failed");
                send_system_text(plugin_host, &route, &format!("❌ {}", e)).await;
            }
        }
        ChannelInput::Log { level, message } => {
            tracing::info!(
                level = %level.unwrap_or_else(|| "info".to_string()),
                message = %message,
                "channel log"
            );
        }
    }
}

fn envelope_content_blocks(text: &str, attachments: &[Attachment]) -> Vec<acp::ContentBlock> {
    let mut blocks = Vec::with_capacity(usize::from(!text.is_empty()) + attachments.len());
    if !text.is_empty() {
        blocks.push(acp::ContentBlock::Text(acp::TextContent::new(text)));
    }
    blocks.extend(attachments.iter().map(attachment_content_block));
    blocks
}

fn attachment_content_block(attachment: &Attachment) -> acp::ContentBlock {
    let mut link = acp::ResourceLink::new(
        attachment.file_name.clone(),
        attachment_uri(&attachment.file_key),
    );
    if !attachment.resource_type.trim().is_empty() {
        link.mime_type = Some(attachment.resource_type.clone());
    }
    link.size = attachment.size;
    acp::ContentBlock::ResourceLink(link)
}

fn attachment_uri(file_key: &str) -> String {
    if file_key.starts_with("file://")
        || file_key.starts_with("http://")
        || file_key.starts_with("https://")
    {
        return file_key.to_string();
    }
    format!(
        "file://{}",
        crate::config::data_dir()
            .join(".cache")
            .join(file_key)
            .to_string_lossy()
    )
}

/// Fire-and-forget helper: emit a `SystemText` to the plugin for this route.
/// Shared by every sub-module in this folder.
pub(super) async fn send_system_text(plugin_host: &Arc<PluginHost>, route: &RouteKey, text: &str) {
    plugin_host
        .send_output(ChannelOutput::SystemText {
            route: route.clone(),
            text: text.to_string(),
            reply_to: None,
        })
        .await;
}

async fn send_prompt_done(
    plugin_host: &Arc<PluginHost>,
    route: &RouteKey,
    message_id: Option<String>,
) {
    plugin_host
        .send_output(ChannelOutput::PromptDone {
            route: route.clone(),
            message_id,
        })
        .await;
}
