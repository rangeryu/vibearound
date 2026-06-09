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

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
      <span className="h-px w-14 bg-border/70 sm:w-20" aria-hidden="true" />
      <span>{label}</span>
      <span className="h-px w-14 bg-border/70 sm:w-20" aria-hidden="true" />
    </div>
  );
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
      <div className="relative mb-2">
        <SectionDivider label={t("Workspaces")} />
        {loading && (
          <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60 sm:flex">
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
                  "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                  selected
                    ? "border-primary/50 bg-primary/5 text-foreground"
                    : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
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
