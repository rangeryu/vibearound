import {
  Activity,
  Bot,
  LayoutGrid,
  MessageSquare,
  Moon,
  Rows3,
  Sun,
  Terminal,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AppPage, ChatRuntimeStatus } from "@/lib/dashboard-types";
import type { Theme } from "@/lib/theme";
import type { ViewMode } from "@/lib/terminal-types";
import { cn } from "@/lib/utils";
import { LanguageMenu } from "./LanguageMenu";

interface AppHeaderProps {
  page: AppPage;
  onPageChange: (page: AppPage) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  theme: Theme;
  onThemeToggle: () => void;
  totalSessions: number;
  runningSessions: number;
  pingMs: number | null;
  chatStatus: ChatRuntimeStatus;
}

export function AppHeader({
  page,
  onPageChange,
  viewMode,
  onViewModeChange,
  theme,
  onThemeToggle,
  totalSessions,
  runningSessions,
  pingMs,
  chatStatus,
}: AppHeaderProps) {
  const { t } = useI18n();
  const chatStatusMeta = {
    connecting: {
      label: t("Connecting to local agent"),
      tone: "text-muted-foreground/60",
      dot: "bg-muted-foreground/50",
      pulse: true,
    },
    ready: {
      label: t("Local agent ready"),
      tone: "text-muted-foreground/60",
      dot: "bg-emerald-400",
      pulse: false,
    },
    working: {
      label: t("Agent working"),
      tone: "text-primary",
      dot: "bg-primary",
      pulse: true,
    },
    attention: {
      label: t("Agent needs input"),
      tone: "text-amber-400",
      dot: "bg-amber-400",
      pulse: true,
    },
  } satisfies Record<
    ChatRuntimeStatus,
    { label: string; tone: string; dot: string; pulse: boolean }
  >;
  const chatMeta = chatStatusMeta[chatStatus];
  const terminalTitle =
    totalSessions > 0
      ? t("{{running}}/{{total}} CLI", {
          running: runningSessions,
          total: totalSessions,
        })
      : t("CLI");
  const localTitle =
    pingMs !== null ? t("local · {{ping}} ms", { ping: pingMs }) : t("local · — ms");

  return (
    <aside className="flex h-full w-14 shrink-0 flex-col items-center border-r border-border bg-background/95 px-1.5 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/25 bg-primary/10 font-mono text-[11px] font-bold text-primary">
        VA
      </div>

      <nav className="mt-5 flex flex-1 flex-col items-center gap-2">
        <Button
          type="button"
          variant={page === "chat" ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() => onPageChange("chat")}
          className={cn(
            "relative h-9 w-9 text-muted-foreground hover:text-foreground",
            page === "chat" && "bg-primary/15 text-primary hover:text-primary",
          )}
          title={`${t("Agent")} · ${chatMeta.label}`}
          aria-label={t("Agent")}
        >
          <MessageSquare className="h-4 w-4" />
          <span
            className={cn(
              "absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
              chatMeta.dot,
              chatMeta.pulse && "animate-pulse",
            )}
          />
        </Button>
        <Button
          type="button"
          variant={page === "terminal" ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() => onPageChange("terminal")}
          className={cn(
            "relative h-9 w-9 text-muted-foreground hover:text-foreground",
            page === "terminal" && "bg-primary/15 text-primary hover:text-primary",
          )}
          title={terminalTitle}
          aria-label={t("CLI")}
        >
          <Terminal className="h-4 w-4" />
          {totalSessions > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 font-mono text-[9px] leading-none text-muted-foreground">
              {totalSessions}
            </span>
          )}
        </Button>

        {page === "terminal" && (
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => v && onViewModeChange(v as ViewMode)}
            className="mt-3 flex flex-col items-center gap-1 rounded-md bg-muted/70 p-1"
          >
            <ToggleGroupItem
              value="tabs"
              aria-label={t("Tab view")}
              title={t("Tab view")}
              className="h-7 w-7 rounded p-0 data-[state=on]:bg-primary/15 data-[state=on]:text-primary text-muted-foreground/50 hover:text-foreground"
            >
              <Rows3 className="h-3.5 w-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="grid"
              aria-label={t("Grid view")}
              title={t("Grid view")}
              className="h-7 w-7 rounded p-0 data-[state=on]:bg-primary/15 data-[state=on]:text-primary text-muted-foreground/50 hover:text-foreground"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </nav>

      <div className="flex flex-col items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md",
            chatMeta.tone,
          )}
          title={chatMeta.label}
          aria-label={chatMeta.label}
        >
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div
          className="flex h-7 w-7 items-center justify-center rounded-md text-emerald-400/80"
          title={localTitle}
          aria-label={localTitle}
        >
          <Activity className="h-3.5 w-3.5" />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onThemeToggle}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label={theme === "dark" ? t("Switch to light theme") : t("Switch to dark theme")}
          title={theme === "dark" ? t("Switch to light theme") : t("Switch to dark theme")}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <LanguageMenu />
      </div>
    </aside>
  );
}
