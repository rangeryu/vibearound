import { ContentBlockRenderer } from "./renderers/ContentBlockRenderer";
import { MessageResponse } from "./MessageResponse";
import { PlanRenderer } from "./renderers/PlanRenderer";
import { ThoughtRenderer } from "./renderers/ThoughtRenderer";
import { ToolCallRenderer } from "./renderers/ToolCallRenderer";
import type {
  ChatMessage,
  ChatMessagePart,
} from "./chatTypes";

export interface ChatDisplaySettings {
  showThinking: boolean;
  showTools: boolean;
}

interface ChatMessagePartsProps {
  message: ChatMessage;
  isStreaming?: boolean;
  displaySettings: ChatDisplaySettings;
}

function renderPart(
  part: ChatMessagePart,
  role: ChatMessage["role"],
  isPartStreaming?: boolean,
  isMessageStreaming?: boolean,
) {
  switch (part.kind) {
    case "content":
      return (
        <ContentBlockRenderer
          key={part.id}
          block={part.block}
          role={role}
          isStreaming={isPartStreaming}
        />
      );
    case "thought":
      return <ThoughtRenderer key={part.id} part={part} />;
    case "tool_call":
      return <ToolCallRenderer key={part.id} part={part} />;
    case "plan":
      return <PlanRenderer key={part.id} part={part} isStreaming={isMessageStreaming} />;
  }
}

function partVisible(part: ChatMessagePart, settings: ChatDisplaySettings) {
  if (part.kind === "thought") return settings.showThinking;
  if (part.kind === "tool_call") return settings.showTools;
  return true;
}

export function ChatMessageParts({
  message,
  isStreaming = false,
  displaySettings,
}: ChatMessagePartsProps) {
  const parts = (message.parts ?? []).filter((part) =>
    partVisible(part, displaySettings),
  );

  if ((message.parts ?? []).length === 0) {
    if (message.role === "user") {
      return <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>;
    }
    if (message.mode === "standalone") {
      return <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>;
    }
    return <MessageResponse content={message.content} isStreaming={isStreaming} />;
  }

  if (parts.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {parts.map((part, index) =>
        renderPart(
          part,
          message.role,
          isStreaming && index === parts.length - 1,
          isStreaming,
        ),
      )}
    </div>
  );
}
