import { ContentBlockRenderer } from "./renderers/ContentBlockRenderer";
import { ChatTurnDisplay } from "./ChatTurnDisplay";
import { MessageResponse } from "./MessageResponse";
import type { ChatContentPart, ChatDisplaySettings, ChatMessage } from "./chatTypes";

interface ChatMessagePartsProps {
  message: ChatMessage;
  isStreaming?: boolean;
  displaySettings: ChatDisplaySettings;
}

export function ChatMessageParts({
  message,
  isStreaming = false,
  displaySettings,
}: ChatMessagePartsProps) {
  if ((message.parts ?? []).length === 0) {
    if (message.role === "user") {
      return <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>;
    }
    if (message.mode === "standalone") {
      return <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>;
    }
    return <MessageResponse content={message.content} isStreaming={isStreaming} />;
  }

  if (message.role === "assistant") {
    return (
      <ChatTurnDisplay
        message={message}
        isStreaming={isStreaming}
        displaySettings={displaySettings}
      />
    );
  }

  const contentParts =
    message.parts?.filter((part): part is ChatContentPart => part.kind === "content") ?? [];
  if (contentParts.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {contentParts.map((part, index) => (
        <ContentBlockRenderer
          key={part.id}
          block={part.block}
          role={message.role}
          isStreaming={isStreaming && index === contentParts.length - 1}
        />
      ))}
    </div>
  );
}
