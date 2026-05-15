import { X } from "lucide-react";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import { getGroupColor, STATUS_COLORS, type TerminalGroup, type ToolType } from "@/lib/terminal-types";
import { AddCliDropdown } from "./AddCliDropdown";

interface TabBarProps {
  groups: TerminalGroup[];
  activeTabId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  tmuxAvailable: boolean | null;
  tmuxSessions: string[];
  onAddCli: (tool: ToolType) => void;
  onAddProfileCli: (profileId: string, launchTarget: string) => void;
  onAttachTmux: (name: string) => void;
  onRefreshTmux: () => void;
}

export function TabBar({
  groups,
  activeTabId,
  onActivate,
  onClose,
  tmuxAvailable,
  tmuxSessions,
  onAddCli,
  onAddProfileCli,
  onAttachTmux,
  onRefreshTmux,
}: TabBarProps) {
  const { t } = useI18n();

  return (
    <nav className="flex shrink-0 items-stretch overflow-x-auto border-b border-border bg-muted/30 scrollbar-none dark:bg-muted/50">
      <div className="flex min-w-0 flex-1 items-stretch">
        {groups.map((group) => {
          const gc = getGroupColor(group.color);
          return (
            <div key={group.id} className="flex items-stretch">
              <div className="relative flex items-center shrink-0">
                <button
                  className="flex items-center gap-1.5 px-2.5 py-2 transition-colors shrink-0"
                  style={{ backgroundColor: `${gc.bg}12` }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: gc.bg }}
                  />
                  <span
                    className="text-[10px] font-semibold font-mono whitespace-nowrap"
                    style={{ color: gc.bg }}
                  >
                    {group.label}
                  </span>
                </button>
                <div
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{ backgroundColor: gc.bg }}
                />
              </div>
              {group.sessions.map((session) => {
                const isActive = session.id === activeTabId;
                return (
                  <div key={session.id} className="relative flex items-center group gap-2">
                    <button
                      onClick={() => onActivate(session.id)}
                      className={`relative flex items-center gap-1.5 pl-2.5 pr-5 py-2 text-[11px] font-mono transition-all whitespace-nowrap ${
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground/50 hover:text-muted-foreground/80"
                      }`}
                      style={{ backgroundColor: isActive ? "var(--background)" : "transparent" }}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                          session.status === "running" ? "animate-pulse" : ""
                        }`}
                        style={{ backgroundColor: STATUS_COLORS[session.status] }}
                      />
                      {session.name}
                    </button>
                    <span
                      className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none"
                      style={{ backgroundColor: isActive ? gc.bg : `${gc.bg}50` }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(session.id);
                      }}
                      className="absolute p-0 h-4 w-4 right-1 top-1/2 -translate-y-1/2 text-muted-foreground/30 hover:text-foreground opacity-0 group-hover:opacity-100"
                      title={t("Close session")}
                      aria-label={t("Close session")}
                    >
                      <X className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                );
              })}
              <div className="flex shrink-0 items-center border-l border-border/50 px-1" />
            </div>
          );
        })}
        <div className="relative ml-auto flex shrink-0 items-center overflow-visible border-l border-border/50 px-1">
          <AddCliDropdown
            variant="top"
            tmuxAvailable={tmuxAvailable}
            tmuxSessions={tmuxSessions}
            onAddCli={onAddCli}
            onAddProfileCli={onAddProfileCli}
            onAttachTmux={onAttachTmux}
            onRefreshTmux={onRefreshTmux}
          />
        </div>
      </div>
    </nav>
  );
}
