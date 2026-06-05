import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Tone } from "./types";

export function RuntimeSection({
  icon,
  title,
  subtitle,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border bg-muted/25 px-3 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{title}</h3>
            <Badge variant="secondary" className="h-5 rounded-md px-2 text-[10px]">
              {count}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </div>
      <div className="space-y-2 p-2.5">{children}</div>
    </section>
  );
}

export function RuntimeRow({
  tone,
  title,
  status,
  details,
  actions,
}: {
  tone: Tone;
  title: string;
  status: string;
  details: Array<string | null | undefined | false>;
  actions?: ReactNode;
}) {
  const visibleDetails = details.filter(Boolean) as string[];

  return (
    <div className="group flex min-h-[58px] items-center gap-3 rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-accent/35">
      <StatusPulse tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-medium text-foreground">
            {title}
          </div>
          <StatusPill tone={tone}>{status}</StatusPill>
        </div>
        {visibleDetails.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {visibleDetails.map((detail, index) => (
              <span key={`${detail}-${index}`} className="max-w-full truncate">
                {detail}
              </span>
            ))}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}

export function RuntimeIconButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => unknown;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      title={title}
      aria-label={title}
      onClick={() => void onClick()}
      className={cn(
        "h-7 w-7 text-muted-foreground hover:text-primary",
        danger && "hover:text-destructive",
      )}
    >
      {children}
    </Button>
  );
}

export function EmptyRuntime({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/15 px-3 py-6 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function StatusPulse({ tone, small }: { tone: Tone; small?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full",
        small ? "h-2 w-2" : "h-2.5 w-2.5",
        toneDot(tone),
      )}
    />
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-[10px] font-medium leading-none",
        tonePill(tone),
      )}
    >
      {children}
    </span>
  );
}

export function toneDot(tone: Tone) {
  switch (tone) {
    case "good":
      return "bg-emerald-500";
    case "busy":
      return "bg-primary";
    case "warning":
      return "bg-amber-500";
    case "danger":
      return "bg-destructive";
    case "muted":
      return "bg-muted-foreground/40";
  }
}

export function toneText(tone: Tone) {
  switch (tone) {
    case "good":
      return "text-emerald-600";
    case "busy":
      return "text-primary";
    case "warning":
      return "text-amber-600";
    case "danger":
      return "text-destructive";
    case "muted":
      return "text-muted-foreground";
  }
}

function tonePill(tone: Tone) {
  switch (tone) {
    case "good":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700";
    case "busy":
      return "border-primary/25 bg-primary/10 text-primary";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700";
    case "danger":
      return "border-destructive/25 bg-destructive/10 text-destructive";
    case "muted":
      return "border-border bg-muted text-muted-foreground";
  }
}
