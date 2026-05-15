"use client";

import { Check, Folder, Loader2 } from "lucide-react";
import type { WorkspaceItem } from "@va/client";
import { useI18n } from "@va/i18n";

import { cn } from "@/lib/utils";

interface NewChatWorkspacePickerProps {
  workspaces: WorkspaceItem[];
  selectedWorkspacePath?: string;
  loading?: boolean;
  onWorkspaceChange: (workspacePath: string) => void;
}

function workspaceLabel(workspace: string) {
  const normalized = workspace.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? workspace;
}

export function NewChatWorkspacePicker({
  workspaces,
  selectedWorkspacePath,
  loading = false,
  onWorkspaceChange,
}: NewChatWorkspacePickerProps) {
  const { t } = useI18n();

  return (
    <section className="mx-auto w-full max-w-4xl">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
          {t("Workspace")}
        </div>
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
        <div className="grid max-h-44 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {workspaces.map((workspace) => {
            const selected = workspace.path === selectedWorkspacePath;
            return (
              <button
                key={workspace.path}
                type="button"
                className={cn(
                  "flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                  selected
                    ? "border-primary/50 bg-primary/5 text-foreground"
                    : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                title={workspace.path}
                aria-pressed={selected}
                onClick={() => onWorkspaceChange(workspace.path)}
              >
                <Folder className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {workspaceLabel(workspace.path)}
                  </span>
                  <span className="block truncate text-[11px] leading-4 text-muted-foreground/70">
                    {workspace.path}
                  </span>
                </span>
                {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
