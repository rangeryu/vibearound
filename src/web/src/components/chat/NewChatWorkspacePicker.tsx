"use client";

import { useState, type FormEvent } from "react";
import { Folder, Loader2, Plus } from "lucide-react";
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

function workspaceFolderName(input: string) {
  const normalized = input.trim().replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? "";
}

function pathSeparatorFor(path: string) {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function NewChatWorkspacePicker({
  workspaces,
  defaultWorkspacePath,
  selectedWorkspacePath,
  loading = false,
  creating = false,
  createError,
  layout = "full",
  onWorkspaceChange,
  onCreateWorkspace,
  className,
}: NewChatWorkspacePickerProps) {
  const { t } = useI18n();
  const [draftName, setDraftName] = useState("");

  const handleCreateWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = workspaceFolderName(draftName);
    if (!name || !onCreateWorkspace || creating) return;
    await onCreateWorkspace(name);
    setDraftName("");
  };
  const handleDraftChange = (value: string) => {
    setDraftName(/[\\/]/.test(value) ? workspaceFolderName(value) : value);
  };
  const panelLayout = layout === "panel";

  return (
    <section className={cn("w-full", !panelLayout && "mx-auto max-w-4xl", className)}>
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
      {onCreateWorkspace && (
        <form className="mb-2 flex min-w-0 gap-2" onSubmit={handleCreateWorkspace}>
          <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-background text-xs text-foreground focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/30">
            {defaultWorkspacePath && (
              <span
                className="max-w-[48%] shrink truncate border-r border-border bg-muted/30 px-3 py-2 font-mono text-[11px] text-muted-foreground"
                title={defaultWorkspacePath}
              >
                {defaultWorkspacePath.replace(/[\\/]+$/, "")}
                <span className="text-muted-foreground/50">
                  {pathSeparatorFor(defaultWorkspacePath)}
                </span>
              </span>
            )}
            <input
              value={draftName}
              onChange={(event) => handleDraftChange(event.target.value)}
              placeholder={t("Folder name")}
              disabled={creating}
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={!workspaceFolderName(draftName) || creating}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            title={t("Create workspace in default folder")}
            aria-label={t("Create workspace in default folder")}
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </button>
        </form>
      )}
      {createError && (
        <div className="mb-2 truncate px-1 text-[11px] text-destructive" title={createError}>
          {createError}
        </div>
      )}
      {workspaces.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {loading ? t("Loading workspaces...") : t("No projects")}
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-2",
            panelLayout ? "overflow-visible" : "max-h-44 overflow-y-auto pr-1 sm:grid-cols-2",
          )}
        >
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
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
