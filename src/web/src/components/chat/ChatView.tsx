"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Loader2, PanelLeftClose, PanelLeftOpen, Wifi, WifiOff } from "lucide-react";
import { createWorkspace, getLaunchSessions, getProfiles, getWorkspaces } from "@/api/sessions";
import { agentIdToToolType, getAgentDisplayName } from "@/lib/agents";
import type { ChatRuntimeStatus } from "@/lib/dashboard-types";
import type { ProfileLaunchOption, WorkspaceItem } from "@va/client";
import { useI18n } from "@va/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatInput } from "./ChatInput";
import {
  ChatSessionSidebar,
  type ChatSessionWorkspaceGroup,
} from "./ChatSessionSidebar";
import { ChatMessageList } from "./ChatMessageList";
import { NewChatAgentPicker } from "./NewChatAgentPicker";
import { NewChatHome } from "./NewChatHome";
import { NewChatWorkspacePicker } from "./NewChatWorkspacePicker";
import { PendingPermissions } from "./PendingPermissions";
import type { ChatSessionSelection } from "./chatTypes";
import { useWebChatConnection } from "./useWebChatConnection";

interface ChatViewProps {
  onStatusChange?: (status: ChatRuntimeStatus) => void;
}

export function ChatView({ onStatusChange }: ChatViewProps) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string>("claude");
  const [sidebarAgentFilter, setSidebarAgentFilter] = useState<string | undefined>();
  const [profiles, setProfiles] = useState<ProfileLaunchOption[]>([]);
  const [profileSelections, setProfileSelections] = useState<Record<string, string | undefined>>(
    {},
  );
  const [launchSessionGroups, setLaunchSessionGroups] = useState<ChatSessionWorkspaceGroup[]>(
    [],
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | undefined>();
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [workspaceCreateError, setWorkspaceCreateError] = useState<string | undefined>();
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionSelections, setSessionSelections] = useState<Record<string, ChatSessionSelection>>(
    {},
  );
  const [showSessionSidebar, setShowSessionSidebar] = useState(true);

  const handleSocketAgentSelected = useCallback((agentId: string) => {
    setSelectedAgent(agentId);
  }, []);

  const {
    messages,
    connected,
    streaming,
    meta,
    agents,
    pendingPermissions,
    sendMessage,
    resumeSession,
    clearConversationView,
    stopStreaming,
    sendPermissionResponse,
    cancelPermissionRequest,
  } = useWebChatConnection({ onAgentSelected: handleSocketAgentSelected });

  const toolType = agentIdToToolType(selectedAgent);
  const sidebarAgentId = sidebarAgentFilter ?? selectedAgent;
  const launchSessions = useMemo(
    () => launchSessionGroups.flatMap((group) => group.sessions),
    [launchSessionGroups],
  );
  const selectedAgentInfo = agents.find((agent) => agent.id === selectedAgent);
  const agentLabel = selectedAgentInfo?.name ?? getAgentDisplayName(selectedAgent);
  const selectedProfileId = profileSelections[selectedAgent];
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.path === selectedWorkspacePath,
  );
  const sessionSelection = sessionSelections[selectedAgent] ?? { kind: "current" };
  const sidebarSessionSelection = sessionSelections[sidebarAgentId] ?? { kind: "current" };
  const selectedLaunchSession =
    sessionSelection.kind === "resume"
      ? launchSessions.find((session) => session.session_id === sessionSelection.sessionId)
      : undefined;
  const chatStatus: ChatRuntimeStatus =
    pendingPermissions.length > 0
      ? "attention"
      : streaming
        ? "working"
        : connected
          ? "ready"
          : "connecting";
  const statusLabel =
    chatStatus === "attention"
      ? t("Agent needs input")
      : chatStatus === "working"
        ? t("Agent working")
        : chatStatus === "ready"
          ? t("Local agent ready")
          : t("Connecting to local agent");
  const statusIcon = !connected ? (
    <WifiOff className="h-3.5 w-3.5" />
  ) : streaming ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Wifi className="h-3.5 w-3.5" />
  );
  const sessionLabel =
    sessionSelection.kind === "new"
      ? t("New chat")
      : selectedLaunchSession
        ? selectedLaunchSession.title
        : meta.sessionId
          ? t("Current session")
          : t("New chat");
  const routeLabel =
    selectedProfileId && selectedProfile
      ? t("{{agent}} / {{profile}}", {
          agent: agentLabel,
          profile: selectedProfile.label,
        })
      : agentLabel;
  const showNewChatHome = messages.length === 0 && sessionSelection.kind !== "resume";
  const sidebarSessionsLoading = workspacesLoading || sessionsLoading;

  useEffect(() => {
    onStatusChange?.(chatStatus);
  }, [chatStatus, onStatusChange]);

  useEffect(() => {
    let cancelled = false;
    setWorkspacesLoading(true);
    void getWorkspaces()
      .then(({ workspaces }) => {
        if (!cancelled) setWorkspaces(workspaces);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[ChatView] failed to load workspaces:", error);
          setWorkspaces([]);
        }
      })
      .finally(() => {
        if (!cancelled) setWorkspacesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedWorkspacePath((current) => {
      if (current && workspaces.some((workspace) => workspace.path === current)) {
        return current;
      }
      return workspaces[0]?.path;
    });
  }, [workspaces]);

  useEffect(() => {
    if (agents.length === 0) return;
    setSidebarAgentFilter((current) => {
      if (current && agents.some((agent) => agent.id === current)) {
        return current;
      }
      if (agents.some((agent) => agent.id === selectedAgent)) {
        return selectedAgent;
      }
      return agents[0]?.id ?? current;
    });
  }, [agents, selectedAgent]);

  useEffect(() => {
    let cancelled = false;
    void getProfiles()
      .then((items) => {
        if (!cancelled) setProfiles(items);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[ChatView] failed to load profiles:", error);
          setProfiles([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sidebarAgentId) {
      setLaunchSessionGroups([]);
      setSessionsLoading(false);
      return;
    }
    if (workspacesLoading) {
      setLaunchSessionGroups([]);
      setSessionsLoading(false);
      return;
    }
    if (workspaces.length === 0) {
      setLaunchSessionGroups([]);
      setSessionsLoading(false);
      return;
    }

    let cancelled = false;
    setSessionsLoading(true);
    setLaunchSessionGroups([]);
    void (async () => {
      return Promise.all(
        workspaces.map(async (workspace) => {
          try {
            return {
              workspace,
              sessions: await getLaunchSessions(sidebarAgentId, false, workspace.path),
            };
          } catch (error) {
            console.warn(
              "[ChatView] failed to load launch sessions for workspace:",
              workspace.path,
              error,
            );
            return { workspace, sessions: [] };
          }
        }),
      );
    })()
      .then((groups) => {
        if (cancelled) return;
        const items = groups.flatMap((group) => group.sessions);
        setLaunchSessionGroups(groups);
        setSessionSelections((prev) => {
          const current = prev[sidebarAgentId];
          if (
            current?.kind === "resume" &&
            !items.some((item) => item.session_id === current.sessionId)
          ) {
            return { ...prev, [sidebarAgentId]: { kind: "current" } };
          }
          return prev;
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[ChatView] failed to load launch sessions:", error);
          setLaunchSessionGroups([]);
        }
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sidebarAgentId, workspaces, workspacesLoading]);

  const handleLaunchChange = useCallback((agentId: string, profileId?: string) => {
    setSelectedAgent(agentId);
    setProfileSelections((prev) => {
      const next = { ...prev };
      if (profileId === undefined) {
        delete next[agentId];
      } else {
        next[agentId] = profileId;
      }
      return next;
    });
  }, []);

  const handleSidebarAgentFilterChange = useCallback((agentId: string) => {
    setSidebarAgentFilter(agentId);
  }, []);

  const handleCreateWorkspace = useCallback(async (name: string) => {
    setWorkspaceCreating(true);
    setWorkspaceCreateError(undefined);
    try {
      const response = await createWorkspace(name);
      setWorkspaces(response.workspaces);
      setSelectedWorkspacePath(response.workspace.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaceCreateError(message);
    } finally {
      setWorkspaceCreating(false);
    }
  }, []);

  const handleSessionChange = useCallback(
    (selection: ChatSessionSelection) => {
      setSessionSelections((prev) => ({ ...prev, [sidebarAgentId]: selection }));
      setSelectedAgent(sidebarAgentId);
      if (selection.kind === "new") {
        clearConversationView();
        return;
      }
      if (selection.kind !== "resume") return;

      const launchSession = launchSessions.find(
        (session) => session.session_id === selection.sessionId,
      );
      if (!launchSession) return;
      resumeSession({
        agentId: sidebarAgentId,
        profileId: profileSelections[sidebarAgentId],
        launchSession,
      });
    },
    [
      clearConversationView,
      launchSessions,
      profileSelections,
      resumeSession,
      sidebarAgentId,
    ],
  );

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const sent = sendMessage({
      text,
      agentId: selectedAgent,
      profileId: selectedProfileId,
      workspacePath: selectedWorkspace?.path,
      sessionSelection,
      launchSession: selectedLaunchSession,
    });
    if (!sent) return;

    setInput("");
    if (sessionSelection.kind === "new") {
      setSessionSelections((prev) => ({ ...prev, [selectedAgent]: { kind: "current" } }));
    }
  }, [
    input,
    selectedAgent,
    selectedLaunchSession,
    selectedProfileId,
    selectedWorkspace?.path,
    sendMessage,
    sessionSelection,
  ]);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {showSessionSidebar && (
        <ChatSessionSidebar
          workspaceGroups={launchSessionGroups}
          agents={agents}
          selectedAgentFilter={sidebarAgentId}
          sessionsLoading={sidebarSessionsLoading}
          sessionSelection={sidebarSessionSelection}
          onAgentFilterChange={handleSidebarAgentFilterChange}
          onSessionChange={handleSessionChange}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowSessionSidebar((value) => !value)}
              className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
              title={showSessionSidebar ? t("Hide sessions") : t("Show sessions")}
              aria-label={showSessionSidebar ? t("Hide sessions") : t("Show sessions")}
            >
              {showSessionSidebar ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </Button>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {routeLabel}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
                <span className="truncate">{sessionLabel}</span>
                {meta.sessionId && (
                  <span className="truncate text-muted-foreground/40">
                    {meta.sessionId.slice(0, 8)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px]",
              chatStatus === "attention"
                ? "text-amber-400"
                : chatStatus === "working"
                  ? "text-primary"
                  : connected
                    ? "text-emerald-400/80"
                    : "text-muted-foreground/60",
            )}
            title={statusLabel}
          >
            {statusIcon}
            <span className="hidden sm:inline">{statusLabel}</span>
          </div>
        </header>

        {showNewChatHome ? (
          <NewChatHome>
            <div className="space-y-4">
              <ChatInput
                value={input}
                onChange={setInput}
                onSubmit={handleSubmit}
                onStop={stopStreaming}
                disabled={!connected}
                submitDisabled={streaming}
                isStreaming={streaming}
                placeholder={
                  connected ? t("Ask {{agent}} anything…", { agent: agentLabel }) : t("Connecting…")
                }
                targetLabel={agentLabel}
                targetTool={toolType}
                selectedAgentId={selectedAgent}
                agents={agents}
                profiles={profiles}
                selectedProfileId={selectedProfileId}
                onLaunchChange={handleLaunchChange}
                showLaunchSelector={false}
                variant="hero"
              />
              <div className="grid gap-4 lg:grid-cols-2">
                <NewChatAgentPicker
                  agents={agents}
                  profiles={profiles}
                  selectedAgentId={selectedAgent}
                  selectedProfileId={selectedProfileId}
                  fallbackAgentLabel={agentLabel}
                  onLaunchChange={handleLaunchChange}
                  className="min-w-0"
                />
                <NewChatWorkspacePicker
                  workspaces={workspaces}
                  selectedWorkspacePath={selectedWorkspace?.path}
                  loading={workspacesLoading}
                  creating={workspaceCreating}
                  createError={workspaceCreateError}
                  onWorkspaceChange={setSelectedWorkspacePath}
                  onCreateWorkspace={handleCreateWorkspace}
                  layout="panel"
                  className="min-w-0"
                />
              </div>
            </div>
          </NewChatHome>
        ) : (
          <>
            <ChatMessageList messages={messages} streaming={streaming} agentLabel={agentLabel} />

            <PendingPermissions
              permissions={pendingPermissions}
              onRespond={sendPermissionResponse}
              onCancel={cancelPermissionRequest}
            />

            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              onStop={stopStreaming}
              disabled={!connected}
              submitDisabled={streaming}
              isStreaming={streaming}
              placeholder={
                connected ? t("Message {{agent}}…", { agent: agentLabel }) : t("Connecting…")
              }
              targetLabel={agentLabel}
              targetTool={toolType}
              selectedAgentId={selectedAgent}
              agents={agents}
              profiles={profiles}
              selectedProfileId={selectedProfileId}
              onLaunchChange={handleLaunchChange}
            />
          </>
        )}
      </div>
    </div>
  );
}
