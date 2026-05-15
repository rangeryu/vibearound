"use client";

import {
  Circle,
  CircleDashed,
  Loader2,
  XCircle,
} from "lucide-react";
import { useI18n } from "@va/i18n";
import { formatJson } from "./contentUtils";
import { ToolContentRenderer } from "./ToolContentRenderer";
import type { ChatToolCallPart } from "../chatTypes";

function statusIcon(status: ChatToolCallPart["status"], active?: boolean) {
  if (active || status === "in_progress") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  }
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "pending") return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />;
  return <Circle className="h-3.5 w-3.5 fill-primary/20 text-primary/70" />;
}

function displayTitle(part: ChatToolCallPart) {
  return part.title === "tool" && part.toolKind ? part.toolKind : part.title;
}

export function ToolCallRenderer({ part }: { part: ChatToolCallPart }) {
  const { t } = useI18n();
  const active = part.active ?? (part.status !== "completed" && part.status !== "failed");
  const title = displayTitle(part);
  const hasDetails =
    Boolean(part.locations?.length) ||
    Boolean(part.content?.length) ||
    part.rawInput !== undefined ||
    part.rawOutput !== undefined;

  if (!hasDetails && part.status === "completed") {
    return (
      <div className="flex min-w-0 items-center gap-2 px-1 py-1 text-xs text-muted-foreground/65">
        {statusIcon(part.status, active)}
        <span className="min-w-0 truncate">{title}</span>
        {part.toolKind && part.title !== part.toolKind && (
          <span className="shrink-0 font-mono text-[10px] uppercase text-muted-foreground/45">
            {part.toolKind}
          </span>
        )}
      </div>
    );
  }

  return (
    <details
      open={active || part.status === "failed"}
      className="rounded-md border border-border/70 bg-muted/20 px-3 py-2"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
        {statusIcon(part.status, active)}
        <span className="min-w-0 truncate font-medium text-foreground">{title}</span>
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
            <ToolContentRenderer key={`${item.type}-${index}`} item={item} />
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
