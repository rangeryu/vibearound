mod dashscope;
mod deepseek;
mod kimi;
mod minimax;
mod zai;

use common::profiles::schema::ProfileDef;
use serde_json::Value;
use va_ai_api_proxy::UniversalEvent;

use self::dashscope::DashScopeProxyAdapter;
use self::deepseek::DeepSeekProxyAdapter;
use self::kimi::KimiProxyAdapter;
use self::minimax::MiniMaxProxyAdapter;
use self::zai::ZaiProxyAdapter;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderRequestSource {
    OpenAiResponses,
    OpenAiChat,
    AnthropicMessages,
}

impl ProviderRequestSource {
    pub(crate) fn replay_scope_key(self) -> &'static str {
        match self {
            Self::OpenAiResponses => "openai-responses",
            Self::OpenAiChat => "openai-chat",
            Self::AnthropicMessages => "anthropic",
        }
    }

    pub(crate) fn supports_deepseek_reasoning_replay(self) -> bool {
        matches!(self, Self::OpenAiResponses | Self::AnthropicMessages)
    }

    pub(crate) fn deepseek_replay_sources() -> [Self; 2] {
        [Self::OpenAiResponses, Self::AnthropicMessages]
    }
}

#[derive(Debug, Clone, Default)]
pub struct ProviderProxyContext {
    pub launch_id: Option<String>,
    pub session_id: Option<String>,
    pub transcript_path: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ProviderProxyAdapter {
    None,
    DeepSeek(DeepSeekProxyAdapter),
    Kimi(KimiProxyAdapter),
    MiniMax(MiniMaxProxyAdapter),
    DashScope(DashScopeProxyAdapter),
    Zai(ZaiProxyAdapter),
}

impl ProviderProxyAdapter {
    pub fn for_profile(profile: &ProfileDef, context: ProviderProxyContext) -> Self {
        match profile.provider.as_str() {
            "deepseek" => Self::DeepSeek(DeepSeekProxyAdapter::new(
                profile.id.clone(),
                profile.provider_settings.deepseek.clone(),
                context,
            )),
            "kimi" => Self::Kimi(KimiProxyAdapter::default()),
            "minimax" => Self::MiniMax(MiniMaxProxyAdapter::default()),
            "dashscope" | "qwen" => Self::DashScope(DashScopeProxyAdapter::new(profile)),
            "zai" => Self::Zai(ZaiProxyAdapter::new(profile)),
            _ => Self::None,
        }
    }

    pub fn prepare_chat_request(
        &mut self,
        source: ProviderRequestSource,
        original_request: &Value,
        chat_request: &mut Value,
    ) {
        match self {
            Self::None => {}
            Self::DeepSeek(adapter) => {
                adapter.prepare_chat_request(source, original_request, chat_request)
            }
            Self::Kimi(_) => {}
            Self::MiniMax(adapter) => adapter.prepare_chat_request(chat_request),
            Self::DashScope(adapter) => {
                adapter.prepare_chat_request(original_request, chat_request)
            }
            Self::Zai(adapter) => adapter.prepare_chat_request(original_request, chat_request),
        }
    }

    pub fn prepare_anthropic_request(&mut self, request: &mut Value) {
        match self {
            Self::None => {}
            Self::DeepSeek(_) => {}
            Self::Kimi(adapter) => adapter.prepare_anthropic_request(request),
            Self::MiniMax(_) => {}
            Self::DashScope(_) => {}
            Self::Zai(_) => {}
        }
    }

    pub fn observe_chat_completion(&mut self, completion: &Value) {
        match self {
            Self::None => {}
            Self::DeepSeek(adapter) => adapter.observe_chat_completion(completion),
            Self::Kimi(_) => {}
            Self::MiniMax(_) => {}
            Self::DashScope(_) => {}
            Self::Zai(_) => {}
        }
    }

    pub fn observe_chat_stream_chunk(&mut self, chunk: &Value) {
        match self {
            Self::None => {}
            Self::DeepSeek(adapter) => adapter.observe_chat_stream_chunk(chunk),
            Self::Kimi(_) => {}
            Self::MiniMax(_) => {}
            Self::DashScope(_) => {}
            Self::Zai(_) => {}
        }
    }

    pub fn transform_upstream_events(&mut self, events: &mut Vec<UniversalEvent>) {
        match self {
            Self::None => {}
            Self::DeepSeek(_) => {}
            Self::Kimi(adapter) => adapter.transform_upstream_events(events),
            Self::MiniMax(adapter) => adapter.transform_upstream_events(events),
            Self::DashScope(_) => {}
            Self::Zai(_) => {}
        }
    }
}

pub fn clear_deepseek_reasoning_for_context(
    profile_id: &str,
    launch_id: Option<&str>,
    session_id: Option<&str>,
) {
    deepseek::clear_reasoning_for_context(profile_id, launch_id, session_id);
}
