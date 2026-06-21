use agent_client_protocol::schema::v1 as acp;
use va_ai_api_bridge::{
    ContentBlock as UniversalContentBlock, Extensions, FinishReason, UniversalEvent, Usage,
};

pub(super) fn final_events(
    stop_reason: acp::StopReason,
    usage: Option<Usage>,
) -> Vec<UniversalEvent> {
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

pub(super) fn acp_usage_to_universal(usage: &acp::Usage) -> Usage {
    Usage {
        input_tokens: Some(usage.input_tokens),
        output_tokens: Some(usage.output_tokens),
        total_tokens: Some(usage.total_tokens),
    }
}

pub(super) fn acp_notification_to_events(args: &acp::SessionNotification) -> Vec<UniversalEvent> {
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

pub(super) fn reasoning_content_start() -> UniversalEvent {
    UniversalEvent::ContentStart {
        index: 1,
        block: UniversalContentBlock::Reasoning {
            text: None,
            encrypted: None,
            extensions: Extensions::new(),
        },
    }
}
