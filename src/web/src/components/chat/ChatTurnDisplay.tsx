"use client";

import { ChevronDown, Loader2 } from "lucide-react";
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

type TurnDisplaySegment =
  | { id: string; kind: "work"; items: WorkItem[] }
  | { id: string; kind: "display"; item: ResultItem };

type TurnDisplayModel = {
  segments: TurnDisplaySegment[];
};

type CompletedTurnDisplayModel = {
  processSegments: TurnDisplaySegment[];
  finalItems: ResultItem[];
  resultItems: ResultItem[];
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

function resultItemIsText(item: ResultItem) {
  return item.kind === "content" && contentBlockHasText(item.block);
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
  const segments: TurnDisplaySegment[] = [];
  let pendingWorkItems: WorkItem[] = [];
  let workSegmentIndex = 0;

  const flushWorkItems = () => {
    if (pendingWorkItems.length === 0) return;
    segments.push({
      id: `work-${workSegmentIndex}-${pendingWorkItems[0]?.id}`,
      kind: "work",
      items: pendingWorkItems,
    });
    pendingWorkItems = [];
    workSegmentIndex += 1;
  };

  const pushDisplayItem = (item: ResultItem) => {
    flushWorkItems();
    segments.push({
      id: `display-${item.id}`,
      kind: "display",
      item,
    });
  };

  parts.forEach((part) => {
    switch (part.kind) {
      case "content":
        pushDisplayItem({ id: part.id, kind: "content", block: part.block });
        break;
      case "tool_call": {
        pendingWorkItems.push({
          id: part.id,
          kind: "part",
          part: workToolCallPart(part),
        });
        toolResultItems(part).forEach(pushDisplayItem);
        break;
      }
      case "thought":
      case "plan":
        pendingWorkItems.push({ id: part.id, kind: "part", part });
        break;
    }
  });

  message.activities?.forEach((activity) => {
    if (parts.length === 0) {
      pendingWorkItems.push({ id: activity.id, kind: "activity", activity });
    }
  });

  if (message.progress) {
    pendingWorkItems.push({
      id: "progress",
      kind: "progress",
      text: message.progress,
      progressKind: message.progressKind ?? "tool",
    });
  }

  flushWorkItems();

  return { segments };
}

function buildCompletedTurnDisplayModel(
  message: ChatMessage,
): CompletedTurnDisplayModel {
  const model = buildTurnDisplayModel(message);
  let lastTextIndex = -1;
  let finalTextStart = -1;

  model.segments.forEach((segment, index) => {
    if (segment.kind === "display" && resultItemIsText(segment.item)) {
      lastTextIndex = index;
    }
  });

  if (lastTextIndex >= 0) {
    finalTextStart = lastTextIndex;
    for (let index = lastTextIndex - 1; index >= 0; index -= 1) {
      const segment = model.segments[index];
      if (segment.kind !== "display" || !resultItemIsText(segment.item)) break;
      finalTextStart = index;
    }
  }

  const processSegments: TurnDisplaySegment[] = [];
  const finalItems: ResultItem[] = [];
  const resultItems: ResultItem[] = [];

  model.segments.forEach((segment, index) => {
    if (segment.kind === "work") {
      processSegments.push(segment);
      return;
    }

    if (resultItemIsText(segment.item)) {
      if (index >= finalTextStart && index <= lastTextIndex) {
        finalItems.push(segment.item);
      } else {
        processSegments.push(segment);
      }
      return;
    }

    resultItems.push(segment.item);
  });

  return { processSegments, finalItems, resultItems };
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

function WorkItemBlock({
  item,
  isStreaming,
  isLatest,
}: {
  item: WorkItem;
  isStreaming: boolean;
  isLatest: boolean;
}) {
  if (item.kind === "activity") {
    return <WorkActivityRow activity={item.activity} />;
  }
  if (item.kind === "progress") {
    return <WorkProgressRow item={item} isStreaming={isStreaming} />;
  }
  return <>{renderWorkPart(item.part, isStreaming, isLatest)}</>;
}

function WorkSequence({
  items,
  isStreaming,
  displaySettings,
}: {
  items: WorkItem[];
  isStreaming: boolean;
  displaySettings: ChatDisplaySettings;
}) {
  const visibleItems = items.filter((item) => workItemVisible(item, displaySettings));
  if (visibleItems.length === 0) return null;

  return (
    <div className="space-y-2">
      {visibleItems.map((item, index) => (
        <div key={item.id}>
          <WorkItemBlock
            item={item}
            isStreaming={isStreaming}
            isLatest={index === visibleItems.length - 1}
          />
        </div>
      ))}
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
      <div className="mt-3">
        <WorkSequence
          items={visibleItems}
          isStreaming={isStreaming}
          displaySettings={displaySettings}
        />
      </div>
    </details>
  );
}

function ProcessDetails({
  segments,
  displaySettings,
}: {
  segments: TurnDisplaySegment[];
  displaySettings: ChatDisplaySettings;
}) {
  const { t } = useI18n();
  const visibleSegments = segments.filter((segment) => {
    if (segment.kind === "display") return true;
    return segment.items.some((item) => workItemVisible(item, displaySettings));
  });

  if (visibleSegments.length === 0) return null;

  return (
    <details className="group/process text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground">
        <span className="min-w-0 truncate">{t("Work details")}</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open/process:rotate-180" />
      </summary>
      <div className="mt-4 space-y-4">
        {visibleSegments.map((segment) => {
          if (segment.kind === "work") {
            return (
              <WorkSequence
                key={segment.id}
                items={segment.items}
                isStreaming={false}
                displaySettings={displaySettings}
              />
            );
          }
          return <ResultBlock key={segment.id} item={segment.item} />;
        })}
      </div>
    </details>
  );
}

function ResultBlock({
  item,
  isStreaming = false,
}: {
  item: ResultItem;
  isStreaming?: boolean;
}) {
  if (item.kind === "content") {
    return (
      <ContentBlockRenderer
        block={item.block}
        role="assistant"
        isStreaming={isStreaming}
      />
    );
  }
  if (item.item.type === "diff") {
    return <DiffRenderer diff={item.item} />;
  }
  if (item.item.type === "content") {
    return <ContentBlockRenderer block={item.item.content} role="assistant" />;
  }
  return null;
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
    const model = buildTurnDisplayModel(message);
    if (model.segments.length === 0) {
      return null;
    }

    return (
      <div className="flex min-w-0 flex-col gap-4">
        {model.segments.map((segment, index) => {
          const isLastSegment = index === model.segments.length - 1;
          if (segment.kind === "work") {
            return (
              <WorkGroup
                key={segment.id}
                items={segment.items}
                isStreaming={isLastSegment}
                displaySettings={displaySettings}
              />
            );
          }
          return (
            <ResultBlock
              key={segment.id}
              item={segment.item}
              isStreaming={isLastSegment}
            />
          );
        })}
      </div>
    );
  }

  const model = buildCompletedTurnDisplayModel(message);
  const hasProcessContent = model.processSegments.some((segment) => {
    if (segment.kind === "display") return true;
    return segment.items.some((item) => workItemVisible(item, displaySettings));
  });
  const hasContent =
    hasProcessContent ||
    model.finalItems.length > 0 ||
    model.resultItems.length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ProcessDetails
        segments={model.processSegments}
        displaySettings={displaySettings}
      />
      {model.finalItems.map((item) => (
        <ResultBlock key={item.id} item={item} />
      ))}
      {model.resultItems.map((item) => (
        <ResultBlock key={item.id} item={item} />
      ))}
    </div>
  );
}
