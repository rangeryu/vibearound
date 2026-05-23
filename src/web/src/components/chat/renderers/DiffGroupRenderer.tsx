"use client";

import { ChevronDown, FileDiff } from "lucide-react";
import { useMemo } from "react";
import { DiffLines, type DiffContent } from "./DiffRenderer";
import { buildLineDiff, diffLineStats } from "./diffUtils";
import { allPathsInsideWorkspace, workspaceRelativePath } from "./pathDisplay";

export type DiffGroupItem = {
  id: string;
  diff: DiffContent;
};

function pluralFiles(count: number) {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

export function DiffGroupRenderer({
  items,
  workspacePath,
}: {
  items: DiffGroupItem[];
  workspacePath?: string;
}) {
  const rows = useMemo(
    () =>
      items.map((item) => {
        const lines = buildLineDiff(item.diff.oldText, item.diff.newText);
        return {
          ...item,
          lines,
          stats: diffLineStats(lines),
        };
      }),
    [items],
  );

  if (rows.length === 0) return null;
  const shouldUseRelativePaths = allPathsInsideWorkspace(
    rows.map((row) => row.diff.path),
    workspacePath,
  );

  const totals = rows.reduce(
    (acc, row) => {
      acc.added += row.stats.added;
      acc.removed += row.stats.removed;
      return acc;
    },
    { added: 0, removed: 0 },
  );

  return (
    <div className="overflow-hidden rounded-md border border-border/70 bg-background/80">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted/55">
          <FileDiff className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="truncate text-sm font-medium text-foreground">
            Edited {pluralFiles(rows.length)}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs">
            <span className="text-emerald-600">+{totals.added}</span>
            <span className="text-red-600">-{totals.removed}</span>
          </div>
        </div>
      </div>
      <div className="border-t border-border/60">
        {rows.map((row) => {
          const displayPath = shouldUseRelativePaths
            ? workspaceRelativePath(row.diff.path, workspacePath) ?? row.diff.path
            : row.diff.path;

          return (
            <details
              key={row.id}
              className="group/diff-row border-t border-border/60 first:border-t-0"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm hover:bg-muted/30">
                <span
                  className="min-w-0 flex-1 truncate text-foreground/90"
                  title={row.diff.path}
                >
                  {displayPath}
                </span>
                <span className="shrink-0 font-mono text-xs text-emerald-600">
                  +{row.stats.added}
                </span>
                <span className="shrink-0 font-mono text-xs text-red-600">
                  -{row.stats.removed}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/diff-row:rotate-180" />
              </summary>
              <div className="max-h-96 overflow-auto border-t border-border/50 bg-background/80 font-mono text-xs">
                <DiffLines lines={row.lines} />
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
