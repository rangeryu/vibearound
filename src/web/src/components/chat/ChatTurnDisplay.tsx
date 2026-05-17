"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { Fragment } from "react";
import { useI18n } from "@va/i18n";
import { ContentBlockRenderer } from "./renderers/ContentBlockRenderer";
import { DiffRenderer } from "./renderers/DiffRenderer";
import { PlanRenderer } from "./renderers/PlanRenderer";
import { ThoughtRenderer } from "./renderers/ThoughtRenderer";
import { ToolCallRenderer } from "./renderers/ToolCallRenderer";
import type {
  ChatActivity,
  ChatContentPart,
  ChatDisplaySettings,
  ChatMessage,
  ChatMessagePart,
  ChatToolCallPart,
} from "./chatTypes";
import type { ContentBlock, ToolCallContent } from "@agentclientprotocol/sdk";

type WorkPart = Exclude<ChatMessagePart, ChatContentPart>;

type WorkItem =
  | { id: string; kind: "part"; part: WorkPart }
  | { id: string; kind: "activity"; activity: ChatActivity }
  | {
      id: string;
      kind: "progress";
      text: string;
      progressKind: NonNullable<ChatMessage["progressKind"]>;
    };

type ResultItem =
  | { id: string; kind: "content"; block: ContentBlock }
  | { id: string; kind: "toolContent"; item: ToolCallContent };

type TurnDisplayModel = {
  displayItems: ResultItem[];
  workItems: WorkItem[];
};

function contentBlockHasText(block: ContentBlock) {
  return block.type === "text" && block.text.trim().length > 0;
}

function contentBlockIsResult(block: ContentBlock) {
  return block.type !== "text";
}

function toolContentIsResult(item: ToolCallContent) {
  return (
    item.type === "diff" ||
    (item.type === "content" && contentBlockIsResult(item.content))
  );
}

function toolContentIsWork(item: ToolCallContent) {
  return (
    item.type === "terminal" ||
    (item.type === "content" && contentBlockHasText(item.content))
  );
}

function toolCallHasResultContent(part: ChatToolCallPart) {
  return part.content?.some(toolContentIsResult) ?? false;
}

function toolResultItems(part: ChatToolCallPart): ResultItem[] {
  const results: ResultItem[] = [];
  part.content?.forEach((item, itemIndex) => {
    if (toolContentIsResult(item)) {
      results.push({
        id: `${part.id}-result-${item.type}-${itemIndex}`,
        kind: "toolContent",
        item,
      });
    }
  });
  return results;
}

export function chatPartVisibleForDisplay(
  part: NonNullable<ChatMessage["parts"]>[number],
  settings: ChatDisplaySettings,
) {
  if (part.kind === "thought") return settings.showThinking;
  if (part.kind === "tool_call") return settings.showTools || toolCallHasResultContent(part);
  return true;
}

function workToolCallPart(part: ChatToolCallPart): ChatToolCallPart {
  return {
    ...part,
    content: part.content?.filter(toolContentIsWork),
  };
}

function buildTurnDisplayModel(message: ChatMessage): TurnDisplayModel {
  const parts = message.parts ?? [];
  const workItems: WorkItem[] = [];
  const displayItems: ResultItem[] = [];

  parts.forEach((part) => {
    switch (part.kind) {
      case "content":
        displayItems.push({ id: part.id, kind: "content", block: part.block });
        break;
      case "tool_call": {
        displayItems.push(...toolResultItems(part));
        workItems.push({ id: part.id, kind: "part", part: workToolCallPart(part) });
        break;
      }
      case "thought":
      case "plan":
        workItems.push({ id: part.id, kind: "part", part });
        break;
    }
  });

  message.activities?.forEach((activity) => {
    if (parts.length === 0) {
      workItems.push({ id: activity.id, kind: "activity", activity });
    }
  });

  if (message.progress) {
    workItems.push({
      id: "progress",
      kind: "progress",
      text: message.progress,
      progressKind: message.progressKind ?? "tool",
    });
  }

  return { displayItems, workItems };
}

function workItemVisible(item: WorkItem, settings: ChatDisplaySettings) {
  if (item.kind === "activity") {
    return item.activity.kind === "thinking" ? settings.showThinking : settings.showTools;
  }
  if (item.kind === "progress") {
    return item.progressKind === "thinking" ? settings.showThinking : settings.showTools;
  }
  if (item.part.kind === "thought") return settings.showThinking;
  if (item.part.kind === "tool_call") return settings.showTools;
  return true;
}

function workItemLabel(item: WorkItem) {
  if (item.kind === "activity") return item.activity.label;
  if (item.kind === "progress") return item.text;
  switch (item.part.kind) {
    case "thought":
      return "Thinking";
    case "tool_call":
      return item.part.title === "tool" && item.part.toolKind
        ? item.part.toolKind
        : item.part.title;
    case "plan":
      return "Plan";
  }
}

function renderWorkPart(
  part: WorkPart,
  isMessageStreaming: boolean,
  isPartStreaming: boolean,
) {
  switch (part.kind) {
    case "thought":
      return <ThoughtRenderer part={part} />;
    case "tool_call":
      return <ToolCallRenderer part={part} defaultOpen={false} />;
    case "plan":
      return <PlanRenderer part={part} isStreaming={isMessageStreaming && isPartStreaming} />;
  }
}

function WorkActivityRow({ activity }: { activity: ChatActivity }) {
  const status =
    activity.active || activity.status === "completed" || activity.status === "failed"
      ? activity.status
      : null;
  return (
    <div className="min-w-0 py-1 text-xs text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2 font-mono">
        <span className="shrink-0 uppercase text-muted-foreground/70">{activity.kind}</span>
        <span className="truncate text-foreground/75">{activity.label}</span>
        {status && <span className="shrink-0 text-muted-foreground/60">{status}</span>}
      </div>
      {activity.detail && (
        <p className="mt-1 whitespace-pre-wrap break-words leading-5 text-muted-foreground/80">
          {activity.detail}
        </p>
      )}
    </div>
  );
}

function WorkProgressRow({
  item,
  isStreaming,
}: {
  item: Extract<WorkItem, { kind: "progress" }>;
  isStreaming: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 py-1 font-mono text-xs text-muted-foreground">
      {isStreaming && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
      <span className="truncate">{item.text}</span>
    </div>
  );
}

function WorkGroup({
  items,
  isStreaming,
  displaySettings,
}: {
  items: WorkItem[];
  isStreaming: boolean;
  displaySettings: ChatDisplaySettings;
}) {
  const { t } = useI18n();
  const visibleItems = items.filter((item) => workItemVisible(item, displaySettings));
  if (visibleItems.length === 0) return null;

  const latest = visibleItems[visibleItems.length - 1];
  const latestLabel = workItemLabel(latest);
  const title = isStreaming
    ? t("Current work: {{label}}", { label: latestLabel })
    : t("Work details");

  return (
    <details className="group/work text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground">
        {isStreaming && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
        <span className="min-w-0 truncate">{title}</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open/work:rotate-180" />
      </summary>
      <div className="mt-3 space-y-2">
        {visibleItems.map((item, index) => {
          const isLatest = index === visibleItems.length - 1;
          if (item.kind === "activity") {
            return <WorkActivityRow key={item.id} activity={item.activity} />;
          }
          if (item.kind === "progress") {
            return <WorkProgressRow key={item.id} item={item} isStreaming={isStreaming} />;
          }
          return (
            <div key={item.id}>
              {renderWorkPart(item.part, isStreaming, isLatest)}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function LiveWorkPart({
  part,
  isMessageStreaming,
  isPartStreaming,
}: {
  part: WorkPart;
  isMessageStreaming: boolean;
  isPartStreaming: boolean;
}) {
  if (part.kind === "tool_call") {
    return <ToolCallRenderer part={workToolCallPart(part)} defaultOpen={false} />;
  }

  if (part.kind === "thought") {
    return <ThoughtRenderer part={part} />;
  }

  const label = workItemLabel({ id: part.id, kind: "part", part });

  return (
    <details className="group/live-work py-1 text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground">
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open/live-work:rotate-180" />
      </summary>
      <div className="mt-3">
        {renderWorkPart(part, isMessageStreaming, isPartStreaming)}
      </div>
    </details>
  );
}

function ResultBlock({ item }: { item: ResultItem }) {
  if (item.kind === "content") {
    return <ContentBlockRenderer block={item.block} role="assistant" />;
  }
  if (item.item.type === "diff") {
    return <DiffRenderer diff={item.item} />;
  }
  if (item.item.type === "content") {
    return <ContentBlockRenderer block={item.item.content} role="assistant" />;
  }
  return null;
}

function ChatLiveTurnDisplay({
  message,
  isStreaming,
  displaySettings,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  displaySettings: ChatDisplaySettings;
}) {
  const parts = message.parts ?? [];
  const hasParts = parts.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {parts.map((part, index) => {
        const isPartStreaming = index === parts.length - 1;
        switch (part.kind) {
          case "content":
            return (
              <ContentBlockRenderer
                key={part.id}
                block={part.block}
                role="assistant"
                isStreaming={isStreaming && isPartStreaming}
              />
            );
          case "thought":
            return displaySettings.showThinking ? (
              <LiveWorkPart
                key={part.id}
                part={part}
                isMessageStreaming={isStreaming}
                isPartStreaming={isPartStreaming}
              />
            ) : null;
          case "plan":
            return (
              <LiveWorkPart
                key={part.id}
                part={part}
                isMessageStreaming={isStreaming}
                isPartStreaming={isPartStreaming}
              />
            );
          case "tool_call": {
            const results = toolResultItems(part);
            const showWork = displaySettings.showTools;
            if (!showWork && results.length === 0) return null;

            return (
              <Fragment key={part.id}>
                {showWork && (
                  <LiveWorkPart
                    part={part}
                    isMessageStreaming={isStreaming}
                    isPartStreaming={isPartStreaming}
                  />
                )}
                {results.map((item) => (
                  <ResultBlock key={item.id} item={item} />
                ))}
              </Fragment>
            );
          }
        }
      })}
      {!hasParts &&
        message.activities
          ?.filter((activity) =>
            activity.kind === "thinking"
              ? displaySettings.showThinking
              : displaySettings.showTools,
          )
          .map((activity) => (
            <WorkActivityRow key={activity.id} activity={activity} />
          ))}
      {message.progress &&
        (message.progressKind === "thinking"
          ? displaySettings.showThinking
          : displaySettings.showTools) && (
          <WorkProgressRow
            item={{
              id: "progress",
              kind: "progress",
              text: message.progress,
              progressKind: message.progressKind ?? "tool",
            }}
            isStreaming={isStreaming}
          />
        )}
    </div>
  );
}

export function ChatTurnDisplay({
  message,
  isStreaming,
  displaySettings,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  displaySettings: ChatDisplaySettings;
}) {
  if (isStreaming) {
    return (
      <ChatLiveTurnDisplay
        message={message}
        isStreaming={isStreaming}
        displaySettings={displaySettings}
      />
    );
  }

  const model = buildTurnDisplayModel(message);
  const hasDisplayItems = model.displayItems.length > 0;

  if (!hasDisplayItems && model.workItems.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <WorkGroup
        items={model.workItems}
        isStreaming={isStreaming}
        displaySettings={displaySettings}
      />
      {model.displayItems.length > 0 && (
        <div className="flex min-w-0 flex-col gap-4">
          {model.displayItems.map((item) => (
            <ResultBlock key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
