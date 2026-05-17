import type { MessageResponseProps } from "./MessageResponse";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { splitMessageSegments } from "./renderers/messageSegments";

/** Heavy markdown/code renderer loaded only when assistant output is shown. */
export function MessageResponseStreamdown({
  content,
  isStreaming = false,
  className,
}: MessageResponseProps) {
  const segments = splitMessageSegments(content);

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "markdown" ? (
          <MarkdownRenderer
            key={`markdown-${index}`}
            isStreaming={isStreaming}
            className={className}
            content={segment.content}
          />
        ) : null,
      )}
    </>
  );
}
