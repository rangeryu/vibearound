"use client";

import { ChevronDown, History, PlusCircle } from "lucide-react";
import type { LaunchSessionInfo } from "@va/client";
import { useI18n } from "@va/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatSessionSelection } from "./chatTypes";
import { COMPACT_MENU_ITEM, COMPACT_SEPARATOR } from "./chatPickerStyles";

interface ChatSessionSelectorProps {
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

export function ChatSessionSelector({
  sessions,
  sessionsLoading = false,
  sessionSelection,
  activeSessionId,
  onSessionChange,
}: ChatSessionSelectorProps) {
  const { t } = useI18n();
  const selectedResumeSession =
    sessionSelection.kind === "resume"
      ? sessions.find((session) => session.session_id === sessionSelection.sessionId)
      : undefined;
  const sessionLabel =
    sessionsLoading
      ? t("Loading sessions…")
      : sessionSelection.kind === "new"
        ? t("New session")
        : selectedResumeSession
          ? selectedResumeSession.title
          : activeSessionId
            ? t("Current session")
            : t("New session");
  const activeSessionDetail = activeSessionId ? shortSessionId(activeSessionId) : t("No active session");
  const sessionDetail =
    selectedResumeSession
      ? `${selectedResumeSession.short_id} · ${formatSessionUpdatedAt(selectedResumeSession.updated_at)}`
      : activeSessionDetail;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 min-w-0 max-w-[16rem] justify-start gap-1 px-1 text-xs font-medium text-muted-foreground"
          title={`${sessionLabel} · ${sessionDetail}`}
        >
          <History className="h-3 w-3 shrink-0" />
          <span className="truncate text-foreground/80">{sessionLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="max-h-[15rem] min-w-[220px] max-w-[min(24rem,calc(100vw-1rem))] overflow-y-auto p-0.5 text-xs"
      >
        <DropdownMenuItem
          className={COMPACT_MENU_ITEM}
          onClick={() => onSessionChange({ kind: "current" })}
        >
          <div className="min-w-0">
            <div className="truncate text-xs">{t("Current session")}</div>
            <div className="truncate text-[11px] leading-4 text-muted-foreground">
              {activeSessionDetail}
            </div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={COMPACT_MENU_ITEM}
          onClick={() => onSessionChange({ kind: "new" })}
        >
          <PlusCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>{t("Start new session")}</span>
        </DropdownMenuItem>
        {sessions.length > 0 && <DropdownMenuSeparator className={COMPACT_SEPARATOR} />}
        {sessions.map((session) => (
          <DropdownMenuItem
            key={session.session_id}
            onClick={() => onSessionChange({ kind: "resume", sessionId: session.session_id })}
            className={`items-start ${COMPACT_MENU_ITEM}`}
          >
            <div className="min-w-0">
              <div className="truncate text-xs">{session.title}</div>
              <div className="truncate text-[11px] leading-4 text-muted-foreground">
                {session.short_id} · {formatSessionUpdatedAt(session.updated_at)}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
