"use client";

import { Check, History, Loader2, MessageSquare, PlusCircle } from "lucide-react";
import type { LaunchSessionInfo } from "@va/client";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatSessionSelection } from "./chatTypes";

interface ChatSessionSidebarProps {
  sessions: LaunchSessionInfo[];
  sessionsLoading?: boolean;
  sessionSelection: ChatSessionSelection;
  activeSessionId?: string;
  onSessionChange: (selection: ChatSessionSelection) => void;
}

function shortSessionId(sessionId: string) {
  return sessionId.slice(0, 8);
}

function formatSessionUpdatedAt(updatedAt: number) {
  if (!updatedAt) return "";
  return new Date(updatedAt * 1000).toLocaleString();
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
  activeSessionId,
  onSessionChange,
}: ChatSessionSidebarProps) {
  const { t } = useI18n();
  const currentIsActive = sessionSelection.kind === "current";
  const newIsActive = sessionSelection.kind === "new";

  return (
    <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-border bg-muted/20 md:flex">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            {t("Sessions")}
          </div>
          <div className="truncate text-xs text-foreground/80">
            {activeSessionId ? shortSessionId(activeSessionId) : t("No active session")}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onSessionChange({ kind: "new" })}
          className="text-muted-foreground hover:text-primary"
          title={t("Start new session")}
          aria-label={t("Start new session")}
        >
          <PlusCircle className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
        <div className="space-y-1">
          <button
            type="button"
            className={sessionButtonClass(currentIsActive)}
            onClick={() => onSessionChange({ kind: "current" })}
          >
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground/90">
                {t("Current session")}
              </span>
              <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                {activeSessionId ? shortSessionId(activeSessionId) : t("No active session")}
              </span>
            </span>
            {currentIsActive && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          </button>

          <button
            type="button"
            className={sessionButtonClass(newIsActive)}
            onClick={() => onSessionChange({ kind: "new" })}
          >
            <PlusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-foreground/90">
                {t("Start new session")}
              </span>
              <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                {t("Use the next message as a fresh chat")}
              </span>
            </span>
            {newIsActive && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          </button>
        </div>

        <div className="mt-4 border-t border-border/50 pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 px-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            <History className="h-3 w-3" />
            {t("Resume")}
          </div>
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
            <div className="space-y-1">
              {sessions.map((session) => {
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
          )}
        </div>
      </div>
    </aside>
  );
}
