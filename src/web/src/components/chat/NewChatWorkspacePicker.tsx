"use client";

import { Folder, Loader2 } from "lucide-react";
import type { WorkspaceItem } from "@va/client";
import { useI18n } from "@va/i18n";

import { cn } from "@/lib/utils";

interface NewChatWorkspacePickerProps {
  workspaces: WorkspaceItem[];
  defaultWorkspacePath?: string;
  selectedWorkspacePath?: string;
  loading?: boolean;
  creating?: boolean;
  createError?: string;
  layout?: "full" | "panel";
  onWorkspaceChange: (workspacePath: string) => void;
  onCreateWorkspace?: (name: string) => Promise<void> | void;
  className?: string;
}

function workspaceLabel(workspace: string) {
  const normalized = workspace.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? workspace;
}

function SectionTitle({ label }: { label: string }) {
  return (
    <div className="px-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
      {label}
    </div>
  );
}

export function NewChatWorkspacePicker({
  workspaces,
  selectedWorkspacePath,
  loading = false,
  layout = "full",
  onWorkspaceChange,
  className,
}: NewChatWorkspacePickerProps) {
  const { t } = useI18n();
  const panelLayout = layout === "panel";

  return (
    <section className={cn("w-full", !panelLayout && "mx-auto max-w-4xl", className)}>
      <div className="relative mb-2 flex items-center justify-between gap-3">
        <SectionTitle label={t("Workspaces")} />
        {loading && (
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("Loading")}
          </div>
        )}
      </div>
      {workspaces.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {loading ? t("Loading workspaces...") : t("No projects")}
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-2",
            panelLayout
              ? "max-h-56 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3"
              : "max-h-44 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {workspaces.map((workspace) => {
            const selected = workspace.path === selectedWorkspacePath;
            return (
              <button
                key={workspace.path}
                type="button"
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                  selected
                    ? "bg-primary/10 text-foreground"
                    : "bg-muted/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                title={workspace.path}
                aria-pressed={selected}
                onClick={() => onWorkspaceChange(workspace.path)}
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium leading-4">
                    {workspaceLabel(workspace.path)}
                  </span>
                  <span className="block truncate text-[10px] leading-4 text-muted-foreground/70">
                    {workspace.path}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
