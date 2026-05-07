mod deepseek;
mod kimi;
mod qwen;
mod zai;

use common::profiles::schema::ProfileDef;
use serde_json::Value;
use va_ai_api_proxy::UniversalEvent;

use self::deepseek::DeepSeekProxyAdapter;
use self::kimi::KimiProxyAdapter;
use self::qwen::QwenProxyAdapter;
use self::zai::ZaiProxyAdapter;

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
    Qwen(QwenProxyAdapter),
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
            "qwen" => Self::Qwen(QwenProxyAdapter::new(profile)),
            "zai" => Self::Zai(ZaiProxyAdapter::new(profile)),
            _ => Self::None,
        }
    }

    pub fn prepare_chat_request(&mut self, original_request: &Value, chat_request: &mut Value) {
        match self {
            Self::None => {}
            Self::DeepSeek(adapter) => adapter.prepare_chat_request(original_request, chat_request),
            Self::Kimi(_) => {}
            Self::Qwen(adapter) => adapter.prepare_chat_request(original_request, chat_request),
            Self::Zai(adapter) => adapter.prepare_chat_request(original_request, chat_request),
        }
    }

    pub fn prepare_anthropic_request(&mut self, request: &mut Value) {
        match self {
            Self::None => {}
            Self::DeepSeek(_) => {}
            Self::Kimi(adapter) => adapter.prepare_anthropic_request(request),
            Self::Qwen(_) => {}
            Self::Zai(_) => {}
        }
    }

    pub fn observe_chat_completion(&mut self, completion: &Value) {
        match self {
            Self::None => {}
            Self::DeepSeek(adapter) => adapter.observe_chat_completion(completion),
            Self::Kimi(_) => {}
            Self::Qwen(_) => {}
            Self::Zai(_) => {}
        }
    }

    pub fn observe_chat_stream_chunk(&mut self, chunk: &Value) {
        match self {
            Self::None => {}
            Self::DeepSeek(adapter) => adapter.observe_chat_stream_chunk(chunk),
            Self::Kimi(_) => {}
            Self::Qwen(_) => {}
            Self::Zai(_) => {}
        }
    }

    pub fn transform_upstream_events(&mut self, events: &mut Vec<UniversalEvent>) {
        match self {
            Self::None => {}
            Self::DeepSeek(_) => {}
            Self::Kimi(adapter) => adapter.transform_upstream_events(events),
            Self::Qwen(_) => {}
            Self::Zai(_) => {}
        }
    }
}
