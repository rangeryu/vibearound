use std::sync::Arc;

use tokio::task::AbortHandle;

use super::transport_stdio::StdioPluginRuntime;
use super::transport_websocket::WebSocketPluginRuntime;
use super::ChannelOutput;

#[derive(Debug)]
pub enum PluginRuntime {
    Stdio(Arc<StdioPluginRuntime>),
    WebSocket(Arc<WebSocketPluginRuntime>),
}

impl PluginRuntime {
    pub fn abort_handle(&self) -> Option<AbortHandle> {
        match self {
            Self::Stdio(runtime) => Some(runtime.abort_handle()),
            Self::WebSocket(_) => None,
        }
    }

    pub async fn send_output(&self, output: ChannelOutput) {
        match self {
            Self::Stdio(runtime) => runtime.send_output(output).await,
            Self::WebSocket(runtime) => runtime.send_output(output).await,
        }
    }

    pub async fn shutdown(&self) {
        match self {
            Self::Stdio(runtime) => runtime.shutdown().await,
            Self::WebSocket(runtime) => runtime.shutdown().await,
        }
    }
}
