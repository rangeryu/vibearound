use serde_json::Value;
use va_ai_api_proxy::{
    AnthropicMessagesTranslator, DecodeState, EncodeState, OpenAiChatTranslator,
    OpenAiResponsesTranslator, UniversalEvent, WireEvent, WireTranslator,
};

use crate::openai_proxy::providers::ProviderRequestSource;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProxyProtocol {
    OpenAiResponses,
    OpenAiChat,
    AnthropicMessages,
}

impl ProxyProtocol {
    pub(super) fn from_api_type(api_type: &str) -> Option<Self> {
        match api_type {
            "openai-responses" => Some(Self::OpenAiResponses),
            "openai-chat" => Some(Self::OpenAiChat),
            "anthropic" => Some(Self::AnthropicMessages),
            _ => None,
        }
    }

    pub(super) fn decode_agent_request(
        self,
        raw: Value,
    ) -> va_ai_api_proxy::Result<va_ai_api_proxy::UniversalRequest> {
        match self {
            Self::OpenAiResponses => OpenAiResponsesTranslator.decode_request(raw),
            Self::OpenAiChat => OpenAiChatTranslator.decode_request(raw),
            Self::AnthropicMessages => AnthropicMessagesTranslator.decode_request(raw),
        }
    }

    pub(super) fn encode_upstream_request(
        self,
        request: &va_ai_api_proxy::UniversalRequest,
    ) -> va_ai_api_proxy::Result<Value> {
        match self {
            Self::OpenAiResponses => OpenAiResponsesTranslator.encode_request(request),
            Self::OpenAiChat => OpenAiChatTranslator.encode_request(request),
            Self::AnthropicMessages => AnthropicMessagesTranslator.encode_request(request),
        }
    }

    pub(super) fn decode_upstream_response(
        self,
        raw: Value,
    ) -> va_ai_api_proxy::Result<Vec<UniversalEvent>> {
        match self {
            Self::OpenAiResponses => OpenAiResponsesTranslator.decode_response(raw),
            Self::OpenAiChat => OpenAiChatTranslator.decode_response(raw),
            Self::AnthropicMessages => AnthropicMessagesTranslator.decode_response(raw),
        }
    }

    pub(super) fn decode_upstream_stream_chunk(
        self,
        raw: Value,
        state: &mut DecodeState,
    ) -> va_ai_api_proxy::Result<Vec<UniversalEvent>> {
        match self {
            Self::OpenAiResponses => OpenAiResponsesTranslator.decode_stream_chunk(raw, state),
            Self::OpenAiChat => OpenAiChatTranslator.decode_stream_chunk(raw, state),
            Self::AnthropicMessages => AnthropicMessagesTranslator.decode_stream_chunk(raw, state),
        }
    }

    pub(super) fn encode_agent_events(
        self,
        events: &[UniversalEvent],
        state: &mut EncodeState,
    ) -> va_ai_api_proxy::Result<Vec<WireEvent>> {
        match self {
            Self::OpenAiResponses => OpenAiResponsesTranslator.encode_events(events, state),
            Self::OpenAiChat => OpenAiChatTranslator.encode_events(events, state),
            Self::AnthropicMessages => AnthropicMessagesTranslator.encode_events(events, state),
        }
    }

    pub(super) fn is_openai_family(self) -> bool {
        matches!(self, Self::OpenAiResponses | Self::OpenAiChat)
    }

    pub(super) fn api_type(self) -> &'static str {
        match self {
            Self::OpenAiResponses => "openai-responses",
            Self::OpenAiChat => "openai-chat",
            Self::AnthropicMessages => "anthropic",
        }
    }

    pub(super) fn provider_request_source(self) -> ProviderRequestSource {
        match self {
            Self::OpenAiResponses => ProviderRequestSource::OpenAiResponses,
            Self::OpenAiChat => ProviderRequestSource::OpenAiChat,
            Self::AnthropicMessages => ProviderRequestSource::AnthropicMessages,
        }
    }
}
