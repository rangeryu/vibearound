import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { toneDot, toneText } from "./primitives";
import type { Tone } from "./types";

export interface RuntimeStatusItem {
  name: string;
  status: string;
  tone: Tone;
}

export function RuntimeStatusCard({
  icon,
  title,
  value,
  detail,
  tone,
  statuses,
  emptyStatus,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  detail: string;
  tone: Tone;
  statuses: RuntimeStatusItem[];
  emptyStatus: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10",
            toneText(tone),
          )}
        >
          {icon}
        </div>
        <StatusDotCluster
          emptyStatus={emptyStatus}
          fallbackTone={tone}
          items={statuses}
          title={title}
        />
      </div>
      <div className="mt-3 text-[11px] font-medium text-muted-foreground">
        {title}
      </div>
      <div className="mt-0.5 flex min-h-7 items-end gap-2">
        <div className="truncate text-lg font-semibold leading-none text-foreground">
          {value}
        </div>
        <div className="truncate pb-0.5 text-[10px] text-muted-foreground">
          {detail}
        </div>
      </div>
    </div>
  );
}

function StatusDotCluster({
  fallbackTone,
  items,
  title,
  emptyStatus,
}: {
  emptyStatus: string;
  fallbackTone: Tone;
  items: RuntimeStatusItem[];
  title: string;
}) {
  const visibleItems =
    items.length > 0
      ? items.slice(0, 6)
      : [{ name: title, status: emptyStatus, tone: fallbackTone }];
  const summary =
    items.length > 0
      ? items.map((item) => `${item.name}: ${item.status}`).join("\n")
      : `${title}: ${emptyStatus}`;

  return (
    <div className="flex max-w-[120px] flex-wrap justify-end gap-1" title={summary}>
      {visibleItems.map((item, index) => (
        <span
          key={`${item.name}-${index}`}
          className={cn("h-2.5 w-2.5 rounded-full", toneDot(item.tone))}
          title={`${item.name}: ${item.status}`}
        />
      ))}
      {items.length > visibleItems.length && (
        <span
          className="text-[10px] leading-none text-muted-foreground"
          title={summary}
        >
          +{items.length - visibleItems.length}
        </span>
      )}
    </div>
  );
}
