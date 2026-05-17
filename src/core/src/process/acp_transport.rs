//! ACP stdio transport helpers.
//!
//! The upstream `ByteStreams` transport treats EOF as a clean background
//! completion and keeps waiting for the foreground task. Supervised child
//! processes need a stronger lifecycle signal: stdout EOF means the bridge
//! should finish so the supervisor can observe the child exit. This wrapper
//! keeps the SDK's line transport and adds an explicit EOF notification.

use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use agent_client_protocol as acp;
use futures::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, BufReader};
use futures::{Sink, Stream};
use tokio::sync::oneshot;

pub(crate) fn notifying_stdio_transport<OB, IB>(
    outgoing: OB,
    incoming: IB,
) -> (
    acp::Lines<
        impl Sink<String, Error = io::Error> + Send + 'static,
        impl Stream<Item = io::Result<String>> + Send + 'static,
    >,
    oneshot::Receiver<()>,
)
where
    OB: AsyncWrite + Send + 'static,
    IB: AsyncRead + Send + 'static,
{
    let (closed_tx, closed_rx) = oneshot::channel();

    let outgoing_sink =
        futures::sink::unfold(Box::pin(outgoing), async move |mut writer, line: String| {
            use futures::AsyncWriteExt;

            let mut bytes = line.into_bytes();
            bytes.push(b'\n');
            writer.write_all(&bytes).await?;
            Ok::<_, io::Error>(writer)
        });

    let incoming_lines = BufReader::new(incoming).lines();
    let incoming_lines = NotifyOnEnd {
        inner: Box::pin(incoming_lines),
        closed_tx: Some(closed_tx),
    };

    (acp::Lines::new(outgoing_sink, incoming_lines), closed_rx)
}

struct NotifyOnEnd<S> {
    inner: Pin<Box<S>>,
    closed_tx: Option<oneshot::Sender<()>>,
}

impl<S> Unpin for NotifyOnEnd<S> {}

impl<S> Stream for NotifyOnEnd<S>
where
    S: Stream<Item = io::Result<String>>,
{
    type Item = io::Result<String>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        match this.inner.as_mut().poll_next(cx) {
            Poll::Ready(None) => {
                if let Some(tx) = this.closed_tx.take() {
                    let _ = tx.send(());
                }
                Poll::Ready(None)
            }
            other => other,
        }
    }
}
