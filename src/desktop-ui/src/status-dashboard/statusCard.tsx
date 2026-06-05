import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { toneDot, toneText } from "./primitives";
import type { Tone } from "./types";

export interface RuntimeStatusItem {
  id: string;
  kind: "agent" | "channel" | "tunnel";
  name: string;
  status: string;
  tone: Tone;
  icon?: ReactNode;
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
      <RuntimeStatusItems
        emptyStatus={emptyStatus}
        items={statuses}
        title={title}
        tone={tone}
      />
    </div>
  );
}

function RuntimeStatusItems({
  emptyStatus,
  items,
  title,
  tone,
}: {
  emptyStatus: string;
  items: RuntimeStatusItem[];
  title: string;
  tone: Tone;
}) {
  if (items.length === 0) {
    return (
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn("h-2.5 w-2.5 rounded-full", toneDot(tone))} />
        <span>{`${title}: ${emptyStatus}`}</span>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={`${item.kind}-${item.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/80 px-1.5 py-1"
          title={`${item.name}: ${item.status}`}
        >
          {item.icon}
          <span className="max-w-[84px] truncate text-[11px] text-muted-foreground">
            {item.name}
          </span>
        </span>
      ))}
    </div>
  );
}
