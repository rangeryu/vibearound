import { useState, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  dialogIcon?: ReactNode;
  details?: Array<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
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
  const [selectedItem, setSelectedItem] = useState<RuntimeStatusItem | null>(null);

  return (
    <>
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
          onSelect={setSelectedItem}
          title={title}
          tone={tone}
        />
      </div>
      <RuntimeStatusDialog
        item={selectedItem}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
      />
    </>
  );
}

function RuntimeStatusItems({
  emptyStatus,
  items,
  onSelect,
  title,
  tone,
}: {
  emptyStatus: string;
  items: RuntimeStatusItem[];
  onSelect: (item: RuntimeStatusItem) => void;
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
    <TooltipProvider>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {items.map((item) => (
          <Tooltip key={`${item.kind}-${item.id}`}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex cursor-pointer rounded-md outline-none ring-offset-background transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => onSelect(item)}
                aria-label={`${item.name}: ${item.status}`}
              >
                {item.icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <div className="space-y-0.5">
                <div className="font-medium">{item.name}</div>
                <div className="text-[11px] opacity-80">{item.status}</div>
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

function RuntimeStatusDialog({
  item,
  onOpenChange,
}: {
  item: RuntimeStatusItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!item) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(400px,calc(100vw-28px))] gap-0 overflow-hidden p-0 sm:max-w-[min(400px,calc(100vw-28px))]">
        <DialogHeader className="border-b border-border px-5 py-3.5 pr-12">
          <div className="flex items-center gap-3">
            {item.dialogIcon ?? item.icon}
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">{item.name}</DialogTitle>
              <DialogDescription className="sr-only">
                Runtime details and controls.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-1.5 px-5 py-3.5">
          {(item.details ?? []).map((detail) => (
            <div
              key={detail.label}
              className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 text-xs leading-5"
            >
              <div className="text-muted-foreground">{detail.label}</div>
              <div className="min-w-0 break-words text-foreground">
                {detail.value}
              </div>
            </div>
          ))}
        </div>
        {item.actions && (
          <DialogFooter className="items-center justify-center border-t border-border px-5 py-3 sm:!justify-center">
            {item.actions}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
