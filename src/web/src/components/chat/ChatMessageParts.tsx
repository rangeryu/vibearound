"use client";

import {
  Circle,
  CircleDashed,
  Code2,
  FileAudio,
  FileDiff,
  FileText,
  Image as ImageIcon,
  Link,
  Loader2,
  Terminal,
  XCircle,
} from "lucide-react";
import { useI18n } from "@va/i18n";
import { cn } from "@/lib/utils";
import { MessageResponse } from "./MessageResponse";
import type {
  ChatMessage,
  ChatMessagePart,
  ChatPlanPart,
  ChatThoughtPart,
  ChatToolCallPart,
} from "./chatTypes";
import type { ContentBlock, ToolCallContent } from "@agentclientprotocol/sdk";

interface ChatMessagePartsProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

function dataUrl(mimeType: string, data: string) {
  return data.startsWith("data:") ? data : `data:${mimeType};base64,${data}`;
}

function fileNameFromUri(uri: string) {
  const clean = uri.split(/[?#]/)[0]?.replace(/[\\/]+$/, "") ?? uri;
  return clean.split(/[\\/]/).filter(Boolean).pop() ?? uri;
}

function formatJson(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function lineCount(text: string | null | undefined) {
  if (!text) return 0;
  return text.split("\n").length;
}

function statusIcon(status: ChatToolCallPart["status"], active?: boolean) {
  if (active || status === "in_progress") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  }
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "pending") return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />;
  return <Circle className="h-3.5 w-3.5 fill-primary/20 text-primary/70" />;
}

function ContentBlockView({
  block,
  role,
  isStreaming,
}: {
  block: ContentBlock;
  role: ChatMessage["role"];
  isStreaming?: boolean;
}) {
  const { t } = useI18n();

  switch (block.type) {
    case "text":
      return role === "user" ? (
        <p className="whitespace-pre-wrap text-sm leading-6">{block.text}</p>
      ) : (
        <MessageResponse content={block.text} isStreaming={isStreaming} />
      );
    case "image":
      return (
        <figure className="overflow-hidden rounded-md border border-border/70 bg-muted/20">
          <img
            src={block.uri ?? dataUrl(block.mimeType, block.data)}
            alt={block.uri ? fileNameFromUri(block.uri) : t("Image")}
            className="max-h-[28rem] w-full object-contain"
            loading="lazy"
          />
          <figcaption className="flex items-center gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" />
            <span className="truncate">{block.uri ?? block.mimeType}</span>
          </figcaption>
        </figure>
      );
    case "audio":
      return (
        <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <FileAudio className="h-3.5 w-3.5" />
            <span>{block.mimeType}</span>
          </div>
          <audio controls src={dataUrl(block.mimeType, block.data)} className="w-full" />
        </div>
      );
    case "resource_link":
      return (
        <a
          href={block.uri}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-start gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm hover:bg-muted/35"
        >
          <Link className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">
              {block.title ?? block.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{block.uri}</span>
            {block.description && (
              <span className="mt-1 block text-xs text-muted-foreground/80">
                {block.description}
              </span>
            )}
          </span>
        </a>
      );
    case "resource": {
      const resource = block.resource;
      const label = fileNameFromUri(resource.uri);
      if ("text" in resource) {
        return (
          <details className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 truncate">{label}</span>
              {resource.mimeType && (
                <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                  {resource.mimeType}
                </span>
              )}
            </summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
              {resource.text}
            </pre>
          </details>
        );
      }
      return (
        <div className="flex min-w-0 items-center gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{label}</div>
            <div className="truncate text-xs text-muted-foreground">
              {resource.mimeType ?? t("Binary resource")}
            </div>
          </div>
        </div>
      );
    }
  }
}

function ToolContentView({ item }: { item: ToolCallContent }) {
  const { t } = useI18n();

  switch (item.type) {
    case "content":
      return <ContentBlockView block={item.content} role="assistant" />;
    case "diff":
      return (
        <details className="rounded-md border border-border/70 bg-background/60 px-3 py-2">
          <summary className="flex cursor-pointer items-center gap-2 text-sm">
            <FileDiff className="h-4 w-4 text-primary" />
            <span className="min-w-0 truncate font-medium">{item.path}</span>
            <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
              {lineCount(item.oldText)} → {lineCount(item.newText)}
            </span>
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {item.oldText !== null && item.oldText !== undefined && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/35 p-3 text-xs leading-5 text-muted-foreground">
                {item.oldText}
              </pre>
            )}
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/35 p-3 text-xs leading-5 text-muted-foreground">
              {item.newText}
            </pre>
          </div>
        </details>
      );
    case "terminal":
      return (
        <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-3 py-2 font-mono text-xs text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" />
          <span>{t("Terminal")}</span>
          <span className="truncate">{item.terminalId}</span>
        </div>
      );
  }
}

function ToolCallCard({ part }: { part: ChatToolCallPart }) {
  const { t } = useI18n();
  const active = part.active ?? (part.status !== "completed" && part.status !== "failed");
  const hasDetails =
    Boolean(part.locations?.length) ||
    Boolean(part.content?.length) ||
    part.rawInput !== undefined ||
    part.rawOutput !== undefined;

  return (
    <details
      open={active || part.status === "failed"}
      className="rounded-md border border-border/70 bg-muted/20 px-3 py-2"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
        {statusIcon(part.status, active)}
        <span className="min-w-0 truncate font-medium text-foreground">{part.title}</span>
        {part.toolKind && (
          <span className="ml-auto shrink-0 rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
            {part.toolKind}
          </span>
        )}
        {part.status && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {part.status}
          </span>
        )}
      </summary>
      {hasDetails && (
        <div className="mt-3 space-y-3">
          {part.locations?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {part.locations.map((location, index) => (
                <span
                  key={`${location.path}-${location.line ?? "file"}-${index}`}
                  className="max-w-full truncate rounded bg-background/70 px-2 py-1 font-mono text-[11px] text-muted-foreground"
                >
                  {location.path}
                  {location.line !== null && location.line !== undefined
                    ? `:${location.line}`
                    : ""}
                </span>
              ))}
            </div>
          ) : null}
          {part.content?.map((item, index) => (
            <ToolContentView key={`${item.type}-${index}`} item={item} />
          ))}
          {part.rawInput !== undefined && (
            <details>
              <summary className="cursor-pointer font-mono text-xs text-muted-foreground">
                {t("Input")}
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
                {formatJson(part.rawInput)}
              </pre>
            </details>
          )}
          {part.rawOutput !== undefined && (
            <details>
              <summary className="cursor-pointer font-mono text-xs text-muted-foreground">
                {t("Output")}
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
                {formatJson(part.rawOutput)}
              </pre>
            </details>
          )}
        </div>
      )}
    </details>
  );
}

function ThoughtCard({ part }: { part: ChatThoughtPart }) {
  const { t } = useI18n();
  const text = part.blocks
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");

  if (!text.trim()) return null;

  return (
    <details className="rounded-md border border-border/60 bg-muted/15 px-3 py-2 text-muted-foreground">
      <summary className="cursor-pointer font-mono text-xs uppercase">
        {t("Thinking")}
      </summary>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-5">{text}</p>
    </details>
  );
}

function PlanCard({ part }: { part: ChatPlanPart }) {
  const { t } = useI18n();

  if (part.plan.entries.length === 0) return null;

  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <Code2 className="h-3.5 w-3.5" />
        {t("Plan")}
      </div>
      <div className="space-y-2">
        {part.plan.entries.map((entry, index) => (
          <div key={`${entry.content}-${index}`} className="flex min-w-0 items-start gap-2">
            <span
              className={cn(
                "mt-1 h-2 w-2 shrink-0 rounded-full",
                entry.status === "completed"
                  ? "bg-primary/70"
                  : entry.status === "in_progress"
                    ? "bg-amber-400"
                    : "bg-muted-foreground/35",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm leading-5 text-foreground">{entry.content}</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                {entry.status} · {entry.priority}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderPart(
  part: ChatMessagePart,
  role: ChatMessage["role"],
  isStreaming?: boolean,
) {
  switch (part.kind) {
    case "content":
      return (
        <ContentBlockView
          key={part.id}
          block={part.block}
          role={role}
          isStreaming={isStreaming}
        />
      );
    case "thought":
      return <ThoughtCard key={part.id} part={part} />;
    case "tool_call":
      return <ToolCallCard key={part.id} part={part} />;
    case "plan":
      return <PlanCard key={part.id} part={part} />;
  }
}

export function ChatMessageParts({ message, isStreaming = false }: ChatMessagePartsProps) {
  const parts = message.parts ?? [];

  if (parts.length === 0) {
    if (message.role === "user") {
      return <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>;
    }
    if (message.mode === "standalone") {
      return <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>;
    }
    return <MessageResponse content={message.content} isStreaming={isStreaming} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {parts.map((part, index) =>
        renderPart(part, message.role, isStreaming && index === parts.length - 1),
      )}
    </div>
  );
}
