"use client";

import { FileDiff } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "@va/i18n";
import { cn } from "@/lib/utils";
import { buildLineDiff, diffLineStats, type DiffLine } from "./diffUtils";
import type { ToolCallContent } from "@agentclientprotocol/sdk";

export type DiffContent = Extract<ToolCallContent, { type: "diff" }>;

export function DiffLines({ lines }: { lines: DiffLine[] }) {
  const { t } = useI18n();

  if (lines.length === 0) {
    return (
      <div className="px-3 py-2 text-muted-foreground">
        {t("No textual changes")}
      </div>
    );
  }

  return (
    <>
      {lines.map((line, index) => (
        <div
          key={`${line.kind}-${line.oldLine ?? "-"}-${line.newLine ?? "-"}-${index}`}
          className={cn(
            "grid min-w-max grid-cols-[1.5rem_3rem_3rem_minmax(24rem,1fr)]",
            line.kind === "added" && "bg-emerald-500/10",
            line.kind === "removed" && "bg-red-500/10",
          )}
        >
          <span
            className={cn(
              "select-none px-2 py-1 text-center",
              line.kind === "added" && "text-emerald-600",
              line.kind === "removed" && "text-red-600",
              line.kind === "context" && "text-muted-foreground/40",
            )}
          >
            {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : ""}
          </span>
          <span className="select-none px-2 py-1 text-right text-muted-foreground/45">
            {line.oldLine ?? ""}
          </span>
          <span className="select-none px-2 py-1 text-right text-muted-foreground/45">
            {line.newLine ?? ""}
          </span>
          <span className="whitespace-pre px-3 py-1 text-foreground/85">
            {line.text || " "}
          </span>
        </div>
      ))}
    </>
  );
}

export function DiffRenderer({ diff }: { diff: DiffContent }) {
  const lines = useMemo(
    () => buildLineDiff(diff.oldText, diff.newText),
    [diff.oldText, diff.newText],
  );
  const stats = useMemo(() => diffLineStats(lines), [lines]);

  return (
    <details className="overflow-hidden rounded-md border border-border/70 bg-background/70">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
        <FileDiff className="h-4 w-4 text-primary" />
        <span className="min-w-0 truncate font-medium">{diff.path}</span>
        <span className="ml-auto shrink-0 font-mono text-xs text-emerald-600">
          +{stats.added}
        </span>
        <span className="shrink-0 font-mono text-xs text-red-600">
          -{stats.removed}
        </span>
      </summary>
      <div className="max-h-96 overflow-auto border-t border-border/60 bg-background/80 font-mono text-xs">
        <DiffLines lines={lines} />
      </div>
    </details>
  );
}
