import { useState } from "react";

import { AppHeader } from "@/components/AppHeader";
import { ChatView } from "@/components/chat";
import { TabBar } from "@/components/TabBar";
import { TerminalWorkspace } from "@/components/TerminalWorkspace";
import { usePing } from "@/hooks/usePing";
import { useSessions } from "@/hooks/useSessions";
import { useTmux } from "@/hooks/useTmux";
import type { AppPage, ChatRuntimeStatus } from "@/lib/dashboard-types";
import type { ViewMode } from "@/lib/terminal-types";
import { cn } from "@/lib/utils";
import { ThemeContext, getResolvedTheme, toggleTheme as applyThemeToggle, type Theme } from "@/lib/theme";

function workspacePaneClass(active: boolean) {
  return cn(
    "absolute inset-0 min-h-0 transition-opacity duration-150",
    active ? "z-10 opacity-100 pointer-events-auto" : "z-0 opacity-0 pointer-events-none",
  );
}

function App() {
  const [page, setPage] = useState<AppPage>("chat");
  const [viewMode, setViewMode] = useState<ViewMode>("tabs");
  const [chatStatus, setChatStatus] = useState<ChatRuntimeStatus>("connecting");
  const [theme, setTheme] = useState<Theme>(() => getResolvedTheme());

  const pingMs = usePing();
  const tmux = useTmux();
  const {
    groups,
    activeTabId,
    setActiveTabId,
    maximizedSession,
    sessionsLoading,
    addCli,
    addProfileCli,
    attachTmux,
    closeSession,
    setSessionState,
    toggleMaximize,
    clearMaximized,
  } = useSessions({
    theme,
    onTmuxAttached: tmux.refresh,
  });

  const totalSessions = groups.reduce((sum, g) => sum + g.sessions.length, 0);
  const runningSessions = groups.reduce(
    (sum, g) => sum + g.sessions.filter((s) => s.status === "running").length,
    0,
  );

  const handleActivateTab = (sessionId: string) => {
    setActiveTabId(sessionId);
    clearMaximized();
  };

  return (
    <ThemeContext.Provider value={theme}>
      <div className="flex h-full min-h-0 overflow-hidden bg-background">
        <AppHeader
          page={page}
          onPageChange={setPage}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          theme={theme}
          onThemeToggle={() => setTheme(applyThemeToggle(theme))}
          totalSessions={totalSessions}
          runningSessions={runningSessions}
          pingMs={pingMs}
          chatStatus={chatStatus}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {page === "terminal" && viewMode === "tabs" && (
            <TabBar
              groups={groups}
              activeTabId={activeTabId}
              onActivate={handleActivateTab}
              onClose={closeSession}
              tmuxAvailable={tmux.available}
              tmuxSessions={tmux.sessions}
              onAddCli={addCli}
              onAddProfileCli={addProfileCli}
              onAttachTmux={attachTmux}
              onRefreshTmux={tmux.refresh}
            />
          )}

          <main className="relative min-h-0 flex-1 overflow-hidden">
            <section
              className={workspacePaneClass(page === "chat")}
              aria-hidden={page !== "chat"}
              inert={page !== "chat"}
            >
              <ChatView onStatusChange={setChatStatus} />
            </section>
            <section
              className={workspacePaneClass(page === "terminal")}
              aria-hidden={page !== "terminal"}
              inert={page !== "terminal"}
            >
              <TerminalWorkspace
                isActive={page === "terminal"}
                groups={groups}
                activeTabId={activeTabId}
                maximizedSession={maximizedSession}
                sessionsLoading={sessionsLoading}
                viewMode={viewMode}
                tmuxAvailable={tmux.available}
                tmuxSessions={tmux.sessions}
                onAddCli={addCli}
                onAddProfileCli={addProfileCli}
                onAttachTmux={attachTmux}
                onRefreshTmux={tmux.refresh}
                onToggleMaximize={toggleMaximize}
                onCloseSession={closeSession}
                onSessionState={setSessionState}
              />
            </section>
          </main>
        </div>
      </div>
    </ThemeContext.Provider>
  );
}

export default App;
