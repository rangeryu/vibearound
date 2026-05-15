"use client";

import { Check, Loader2, MessageSquare, PlusCircle } from "lucide-react";
import type { LaunchSessionInfo } from "@va/client";
import { useI18n } from "@va/i18n";

import { cn } from "@/lib/utils";
import type { ChatSessionSelection } from "./chatTypes";

interface ChatSessionSidebarProps {
  sessions: LaunchSessionInfo[];
  sessionsLoading?: boolean;
  sessionSelection: ChatSessionSelection;
  onSessionChange: (selection: ChatSessionSelection) => void;
}

function formatSessionUpdatedAt(updatedAt: number) {
  if (!updatedAt) return "";
  return new Date(updatedAt * 1000).toLocaleString();
}

function workspaceLabel(workspace: string) {
  const normalized = workspace.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? workspace;
}

function groupSessionsByWorkspace(sessions: LaunchSessionInfo[]) {
  const groups: Array<{ workspace: string; label: string; sessions: LaunchSessionInfo[] }> = [];
  const byWorkspace = new Map<string, (typeof groups)[number]>();

  for (const session of sessions) {
    let group = byWorkspace.get(session.workspace);
    if (!group) {
      group = {
        workspace: session.workspace,
        label: workspaceLabel(session.workspace),
        sessions: [],
      };
      byWorkspace.set(session.workspace, group);
      groups.push(group);
    }
    group.sessions.push(session);
  }

  return groups;
}

function sessionButtonClass(active: boolean) {
  return cn(
    "group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors",
    active
      ? "bg-primary/10 text-primary"
      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
  );
}

export function ChatSessionSidebar({
  sessions,
  sessionsLoading = false,
  sessionSelection,
  onSessionChange,
}: ChatSessionSidebarProps) {
  const { t } = useI18n();
  const newIsActive = sessionSelection.kind === "new" || sessionSelection.kind === "current";
  const sessionGroups = groupSessionsByWorkspace(sessions);

  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-border bg-muted/20 md:flex">
      <div className="border-b border-border/60 px-3 py-2.5">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
          {t("Chats")}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
        <div className="space-y-1">
          <button
            type="button"
            className={sessionButtonClass(newIsActive)}
            onClick={() => onSessionChange({ kind: "new" })}
          >
            <PlusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground/90">
                {t("New chat")}
              </span>
              <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                {t("Use the next message as a fresh chat")}
              </span>
            </span>
            {newIsActive && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          </button>
        </div>

        <div className="mt-4 border-t border-border/50 pt-3">
          {sessionsLoading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("Loading sessions...")}
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-2 py-4 text-xs text-muted-foreground/60">
              {t("No saved sessions")}
            </div>
          ) : (
            <div className="space-y-4">
              {sessionGroups.map((group) => (
                <section key={group.workspace}>
                  <div
                    className="mb-1.5 truncate px-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60"
                    title={group.workspace}
                  >
                    {group.label}
                  </div>
                  <div className="space-y-1">
                    {group.sessions.map((session) => {
                      const active =
                        sessionSelection.kind === "resume" &&
                        sessionSelection.sessionId === session.session_id;
                      return (
                        <button
                          key={session.session_id}
                          type="button"
                          className={sessionButtonClass(active)}
                          onClick={() =>
                            onSessionChange({ kind: "resume", sessionId: session.session_id })
                          }
                        >
                          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-foreground/90">
                              {session.title}
                            </span>
                            <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                              {session.short_id} - {formatSessionUpdatedAt(session.updated_at)}
                            </span>
                          </span>
                          {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
