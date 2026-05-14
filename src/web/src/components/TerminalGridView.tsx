import { TerminalPanel } from "@/components/TerminalPanel";
import {
  getGroupColor,
  type TerminalGroup,
  type TerminalStatus,
  type ToolType,
  type ViewMode,
} from "@/lib/terminal-types";

interface TerminalGridViewProps {
  groups: TerminalGroup[];
  isActive: boolean;
  viewMode: ViewMode;
  onToggleMaximize: (id: string) => void;
  onSessionState: (sessionId: string, tool: ToolType, status: TerminalStatus) => void;
  onCloseSession: (sessionId: string) => void;
}

export function TerminalGridView({
  groups,
  isActive,
  viewMode,
  onToggleMaximize,
  onSessionState,
  onCloseSession,
}: TerminalGridViewProps) {
  return (
    <div
      className="h-full overflow-y-auto p-3 pr-5 scrollbar-thin"
      style={{ overscrollBehavior: "contain" }}
    >
      <div className="flex flex-col gap-6 pb-6">
        {groups.map((group) => {
          const gc = getGroupColor(group.color);
          return (
            <section key={group.id}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: gc.bg }}
                />
                <h2
                  className="text-[11px] font-bold uppercase tracking-wider font-mono"
                  style={{ color: gc.bg }}
                >
                  {group.label}
                </h2>
                <span className="text-[10px] text-muted-foreground/30 font-mono">
                  {group.sessions.filter((s) => s.status === "running").length}/
                  {group.sessions.length}
                </span>
                <div className="flex-1 h-px" style={{ backgroundColor: `${gc.bg}25` }} />
              </div>
              <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
                {group.sessions.map((session) => (
                  <div key={session.id} className="h-[480px] lg:h-[520px]">
                    <TerminalPanel
                      session={session}
                      isActive={isActive}
                      viewMode={viewMode}
                      onToggleMaximize={() => onToggleMaximize(session.id)}
                      onClose={() => onCloseSession(session.id)}
                      onSessionState={(tool, status) => onSessionState(session.id, tool, status)}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
