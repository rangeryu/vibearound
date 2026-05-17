"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Loader2,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  archiveLaunchSession,
  createWorkspace,
  getLaunchSessions,
  getProfiles,
  getWorkspaces,
  uploadChatFile,
} from "@/api/sessions";
import { getAgentDisplayName } from "@/lib/agents";
import type { ChatRuntimeStatus } from "@/lib/dashboard-types";
import type {
  LaunchSessionInfo,
  ProfileLaunchOption,
  WebVerboseSettings,
  WorkspaceItem,
} from "@va/client";
import { useI18n } from "@va/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatInput } from "./ChatInput";
import { deleteCachedChatSession } from "./chatSessionCache";
import {
  ChatSessionSidebar,
  type ChatSessionWorkspaceGroup,
} from "./ChatSessionSidebar";
import { ChatMessageList } from "./ChatMessageList";
import { NewChatAgentPicker } from "./NewChatAgentPicker";
import { NewChatHome } from "./NewChatHome";
import { NewChatWorkspacePicker } from "./NewChatWorkspacePicker";
import { PendingPermissions } from "./PendingPermissions";
import type { ChatAttachment, ChatSessionSelection } from "./chatTypes";
import { useWebChatConnection } from "./useWebChatConnection";

interface ChatViewProps {
  webSettings: WebVerboseSettings;
  onStatusChange?: (status: ChatRuntimeStatus) => void;
  onOpenAppSidebar?: () => void;
}

const DIRECT_PROFILE_ID = "direct";
const LAUNCH_SELECTION_STORAGE_KEY = "vibearound.webChat.launchSelection";
const SESSION_SIDEBAR_WIDTH_STORAGE_KEY = "vibearound.webChat.sessionSidebarWidth";
const SESSION_SIDEBAR_DEFAULT_WIDTH = 256;
const SESSION_SIDEBAR_MIN_WIDTH = 224;
const SESSION_SIDEBAR_MAX_WIDTH = 420;

interface StoredLaunchSelection {
  agentId?: string;
  profileId?: string;
}

function readStoredLaunchSelection(): StoredLaunchSelection {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LAUNCH_SELECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredLaunchSelection;
    return {
      agentId: typeof parsed.agentId === "string" ? parsed.agentId : undefined,
      profileId: typeof parsed.profileId === "string" ? parsed.profileId : undefined,
    };
  } catch {
    return {};
  }
}

function writeStoredLaunchSelection(selection: Required<StoredLaunchSelection>) {
  try {
    window.localStorage.setItem(LAUNCH_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Ignore storage failures; the picker still works for this session.
  }
}

function clampSessionSidebarWidth(width: number) {
  return Math.min(
    SESSION_SIDEBAR_MAX_WIDTH,
    Math.max(SESSION_SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

function readStoredSessionSidebarWidth() {
  if (typeof window === "undefined") return SESSION_SIDEBAR_DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(SESSION_SIDEBAR_WIDTH_STORAGE_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed)
    ? clampSessionSidebarWidth(parsed)
    : SESSION_SIDEBAR_DEFAULT_WIDTH;
}

function writeStoredSessionSidebarWidth(width: number) {
  try {
    window.localStorage.setItem(
      SESSION_SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampSessionSidebarWidth(width)),
    );
  } catch {
    // Width persistence is cosmetic; dragging should still work.
  }
}

function profileTargetsAgent(profile: ProfileLaunchOption, agentId: string) {
  return profile.launch_targets.some((target) => target.id === agentId);
}

export function ChatView({
  webSettings,
  onStatusChange,
  onOpenAppSidebar,
}: ChatViewProps) {
  const { t } = useI18n();
  const [storedLaunchSelection] = useState(readStoredLaunchSelection);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | undefined>();
  const [selectedAgent, setSelectedAgent] = useState<string>(
    storedLaunchSelection.agentId ?? "claude",
  );
  const [sidebarAgentFilter, setSidebarAgentFilter] = useState<string | undefined>();
  const [profiles, setProfiles] = useState<ProfileLaunchOption[]>([]);
  const [profileSelections, setProfileSelections] = useState<Record<string, string | undefined>>(
    () =>
      storedLaunchSelection.agentId
        ? {
            [storedLaunchSelection.agentId]:
              storedLaunchSelection.profileId ?? DIRECT_PROFILE_ID,
          }
        : {},
  );
  const [launchSessionGroups, setLaunchSessionGroups] = useState<ChatSessionWorkspaceGroup[]>(
    [],
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState<string | undefined>();
  const [selectedWorkspacePath, setSelectedWorkspacePath] = useState<string | undefined>();
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [workspaceCreateError, setWorkspaceCreateError] = useState<string | undefined>();
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionSelections, setSessionSelections] = useState<Record<string, ChatSessionSelection>>(
    {},
  );
  const [selectedLaunchSessions, setSelectedLaunchSessions] = useState<
    Record<string, LaunchSessionInfo | undefined>
  >({});
  const [archivingSessionId, setArchivingSessionId] = useState<string | undefined>();
  const [showSessionSidebar, setShowSessionSidebar] = useState(true);
  const [sessionSidebarWidth, setSessionSidebarWidth] = useState(
    readStoredSessionSidebarWidth,
  );
  const [mobileSessionSidebarOpen, setMobileSessionSidebarOpen] = useState(false);

  const handleSocketAgentSelected = useCallback(
    (agentId: string, source: "config" | "system") => {
      if (source === "config" && storedLaunchSelection.agentId) return;
      setSelectedAgent(agentId);
    },
    [storedLaunchSelection.agentId],
  );

  const {
    messages,
    connected,
    streaming,
    meta,
    agents,
    pendingPermissions,
    resumeReplay,
    sendMessage,
    resumeSession,
    clearConversationView,
    stopStreaming,
    sendPermissionResponse,
    cancelPermissionRequest,
  } = useWebChatConnection({ onAgentSelected: handleSocketAgentSelected });

  const sidebarAgentId = sidebarAgentFilter ?? selectedAgent;
  const launchSessions = useMemo(
    () => launchSessionGroups.flatMap((group) => group.sessions),
    [launchSessionGroups],
  );
  const selectedAgentInfo = agents.find((agent) => agent.id === selectedAgent);
  const agentLabel = selectedAgentInfo?.name ?? getAgentDisplayName(selectedAgent);
  const selectedProfileId = profileSelections[selectedAgent] ?? DIRECT_PROFILE_ID;
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.path === selectedWorkspacePath,
  );
  const sessionSelection = sessionSelections[selectedAgent] ?? { kind: "current" };
  const sidebarSessionSelection = sessionSelections[sidebarAgentId] ?? { kind: "current" };
  const selectedLaunchSession =
    sessionSelection.kind === "resume" &&
    selectedLaunchSessions[selectedAgent]?.session_id === sessionSelection.sessionId
      ? selectedLaunchSessions[selectedAgent]
      : sessionSelection.kind === "resume"
        ? launchSessions.find((session) => session.session_id === sessionSelection.sessionId)
        : undefined;
  const replayLoading = Boolean(resumeReplay);
  const chatStatus: ChatRuntimeStatus =
    pendingPermissions.length > 0
      ? "attention"
      : streaming || replayLoading
        ? "working"
        : connected
          ? "ready"
          : "connecting";
  const statusLabel =
    chatStatus === "attention"
      ? t("Agent needs input")
      : chatStatus === "working"
        ? replayLoading
          ? t("Loading chat history")
          : t("Agent working")
        : chatStatus === "ready"
          ? t("Local agent ready")
          : t("Connecting to local agent");
  const statusIcon = !connected ? (
    <WifiOff className="h-3.5 w-3.5" />
  ) : streaming || replayLoading ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Wifi className="h-3.5 w-3.5" />
  );
  const headerSessionLabel =
    sessionSelection.kind === "new"
      ? null
      : selectedLaunchSession
        ? selectedLaunchSession.title
        : meta.sessionId
          ? t("Current session")
          : null;
  const routeLabel =
    selectedProfileId && selectedProfile
      ? t("{{agent}} / {{profile}}", {
          agent: agentLabel,
          profile: selectedProfile.label,
        })
      : agentLabel;
  const showNewChatHome = messages.length === 0 && sessionSelection.kind !== "resume";
  const sidebarSessionsLoading = workspacesLoading || sessionsLoading;
  const displaySettings = useMemo(
    () => ({
      showThinking: webSettings.show_thinking,
      showTools: webSettings.show_tool_use,
    }),
    [webSettings],
  );

  useEffect(() => {
    onStatusChange?.(chatStatus);
  }, [chatStatus, onStatusChange]);

  useEffect(() => {
    if (!selectedAgent) return;
    setProfileSelections((prev) =>
      prev[selectedAgent] === undefined
        ? { ...prev, [selectedAgent]: DIRECT_PROFILE_ID }
        : prev,
    );
  }, [selectedAgent]);

  useEffect(() => {
    if (!selectedAgent || profiles.length === 0) return;
    const profileId = profileSelections[selectedAgent] ?? DIRECT_PROFILE_ID;
    if (profileId === DIRECT_PROFILE_ID) return;
    const profile = profiles.find((item) => item.id === profileId);
    if (profile && profileTargetsAgent(profile, selectedAgent)) return;
    setProfileSelections((prev) => ({ ...prev, [selectedAgent]: DIRECT_PROFILE_ID }));
  }, [profiles, profileSelections, selectedAgent]);

  useEffect(() => {
    if (!selectedAgent) return;
    writeStoredLaunchSelection({
      agentId: selectedAgent,
      profileId: profileSelections[selectedAgent] ?? DIRECT_PROFILE_ID,
    });
  }, [profileSelections, selectedAgent]);

  useEffect(() => {
    if (agents.length === 0) return;
    if (agents.some((agent) => agent.id === selectedAgent)) return;
    setSelectedAgent(agents[0]?.id ?? selectedAgent);
  }, [agents, selectedAgent]);

  useEffect(() => {
    let cancelled = false;
    setWorkspacesLoading(true);
    void getWorkspaces()
      .then(({ workspaces, default_workspace }) => {
        if (!cancelled) {
          setWorkspaces(workspaces);
          setDefaultWorkspacePath(default_workspace);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[ChatView] failed to load workspaces:", error);
          setWorkspaces([]);
          setDefaultWorkspacePath(undefined);
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
      return { ...prev, [agentId]: profileId ?? DIRECT_PROFILE_ID };
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
      setDefaultWorkspacePath(response.default_workspace);
      setSelectedWorkspacePath(response.workspace.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaceCreateError(message);
    } finally {
      setWorkspaceCreating(false);
    }
  }, []);

  const handleSessionChange = useCallback(
    (selection: ChatSessionSelection, session?: LaunchSessionInfo) => {
      if (selection.kind === "new") {
        setSessionSelections((prev) => ({ ...prev, [sidebarAgentId]: selection }));
        setSelectedLaunchSessions((prev) => {
          const next = { ...prev };
          delete next[sidebarAgentId];
          return next;
        });
        setSelectedAgent(sidebarAgentId);
        clearConversationView({ abortReplay: true });
        setAttachments([]);
        setAttachmentError(undefined);
        return;
      }
      if (selection.kind !== "resume") return;

      const launchSession = session ?? launchSessions.find(
        (item) => item.session_id === selection.sessionId,
      );
      if (!launchSession) return;

      setSessionSelections((prev) => ({ ...prev, [sidebarAgentId]: selection }));
      setSelectedLaunchSessions((prev) => ({
        ...prev,
        [sidebarAgentId]: launchSession,
      }));
      setSelectedAgent(sidebarAgentId);
      setSelectedWorkspacePath(launchSession.workspace);
      setAttachments([]);
      setAttachmentError(undefined);
      resumeSession({
        agentId: sidebarAgentId,
        profileId: profileSelections[sidebarAgentId] ?? DIRECT_PROFILE_ID,
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

  const handleMobileSessionChange = useCallback(
    (selection: ChatSessionSelection, session?: LaunchSessionInfo) => {
      handleSessionChange(selection, session);
      setMobileSessionSidebarOpen(false);
    },
    [handleSessionChange],
  );

  const handleSessionSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sessionSidebarWidth;
      let nextWidth = startWidth;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        nextWidth = clampSessionSidebarWidth(
          startWidth + moveEvent.clientX - startX,
        );
        setSessionSidebarWidth(nextWidth);
      };
      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        writeStoredSessionSidebarWidth(nextWidth);
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [sessionSidebarWidth],
  );

  const handleArchiveSession = useCallback(
    async (session: LaunchSessionInfo) => {
      setArchivingSessionId(session.session_id);
      try {
        await archiveLaunchSession(session.agent_id, session.session_id, session.workspace);
        void deleteCachedChatSession({
          agentId: session.agent_id,
          workspace: session.workspace,
          sessionId: session.session_id,
        }).catch((error) => {
          console.warn("[ChatView] failed to delete archived session cache:", error);
        });
        setLaunchSessionGroups((prev) =>
          prev.map((group) => ({
            ...group,
            sessions: group.sessions.filter(
              (item) =>
                item.agent_id !== session.agent_id || item.session_id !== session.session_id,
            ),
          })),
        );
        setSelectedLaunchSessions((prev) => {
          if (prev[session.agent_id]?.session_id !== session.session_id) return prev;
          const next = { ...prev };
          delete next[session.agent_id];
          return next;
        });
        setSessionSelections((prev) => {
          const current = prev[session.agent_id];
          if (current?.kind !== "resume" || current.sessionId !== session.session_id) {
            return prev;
          }
          return { ...prev, [session.agent_id]: { kind: "new" } };
        });
        if (
          selectedAgent === session.agent_id &&
          sessionSelection.kind === "resume" &&
          sessionSelection.sessionId === session.session_id
        ) {
          clearConversationView({ abortReplay: true });
        }
      } catch (error) {
        console.warn("[ChatView] failed to archive launch session:", error);
      } finally {
        setArchivingSessionId(undefined);
      }
    },
    [clearConversationView, selectedAgent, sessionSelection],
  );

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const rejected = files.find((file) => !isAllowedAttachment(file));
    if (rejected) {
      setAttachmentError(describeRejection(rejected, t));
      return;
    }
    setAttachmentsUploading(true);
    setAttachmentError(undefined);
    try {
      const uploaded = await Promise.all(files.map((file) => uploadChatFile(file)));
      setAttachments((prev) => [
        ...prev,
        ...uploaded.map((file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mime_type,
          size: file.size,
          uri: file.uri,
        })),
      ]);
    } catch (error) {
      console.warn("[ChatView] failed to upload attachment:", error);
      setAttachmentError(
        error instanceof Error ? error.message : t("Failed to upload attachment"),
      );
    } finally {
      setAttachmentsUploading(false);
    }
  }, [t]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    setAttachmentError(undefined);
  }, []);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (attachmentsUploading) return;
    if (replayLoading) return;
    const sent = sendMessage({
      text,
      attachments,
      agentId: selectedAgent,
      profileId: selectedProfileId,
      workspacePath: selectedWorkspace?.path,
      sessionSelection,
      launchSession: selectedLaunchSession,
    });
    if (!sent) return;

    setInput("");
    setAttachments([]);
    setAttachmentError(undefined);
    if (sessionSelection.kind === "new") {
      setSessionSelections((prev) => ({ ...prev, [selectedAgent]: { kind: "current" } }));
    }
  }, [
    attachments,
    attachmentsUploading,
    input,
    replayLoading,
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
        <div
          className="relative hidden h-full shrink-0 md:flex"
          style={{ width: sessionSidebarWidth }}
        >
          <ChatSessionSidebar
            workspaceGroups={launchSessionGroups}
            agents={agents}
            selectedAgentFilter={sidebarAgentId}
            className="flex w-full"
            style={{ width: "100%" }}
            sessionsLoading={sidebarSessionsLoading}
            loadingSessionId={resumeReplay?.sessionId}
            archivingSessionId={archivingSessionId}
            sessionSelection={sidebarSessionSelection}
            onAgentFilterChange={handleSidebarAgentFilterChange}
            onSessionChange={handleSessionChange}
            onArchiveSession={handleArchiveSession}
          />
          <button
            type="button"
            className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none rounded-sm bg-transparent transition-colors hover:bg-primary/25 focus-visible:bg-primary/25 focus-visible:outline-none"
            aria-label={t("Resize sessions")}
            title={t("Resize sessions")}
            onPointerDown={handleSessionSidebarResizeStart}
          />
        </div>
      )}
      {mobileSessionSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            aria-label={t("Close sessions")}
            onClick={() => setMobileSessionSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[min(18rem,86vw)] shadow-lg">
            <ChatSessionSidebar
              workspaceGroups={launchSessionGroups}
              agents={agents}
              selectedAgentFilter={sidebarAgentId}
              variant="mobile"
              sessionsLoading={sidebarSessionsLoading}
              loadingSessionId={resumeReplay?.sessionId}
              archivingSessionId={archivingSessionId}
              sessionSelection={sidebarSessionSelection}
              onAgentFilterChange={handleSidebarAgentFilterChange}
              onSessionChange={handleMobileSessionChange}
              onArchiveSession={handleArchiveSession}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileSessionSidebarOpen(true)}
              className="text-muted-foreground hover:text-foreground md:hidden"
              title={t("Show sessions")}
              aria-label={t("Show sessions")}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
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
              {(headerSessionLabel || meta.sessionId) && (
                <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
                  {headerSessionLabel && (
                    <span className="truncate">{headerSessionLabel}</span>
                  )}
                  {meta.sessionId && (
                    <span className="truncate text-muted-foreground/40">
                      {meta.sessionId.slice(0, 8)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
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
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onOpenAppSidebar}
              className="text-muted-foreground hover:text-foreground md:hidden"
              title={t("Show navigation")}
              aria-label={t("Show navigation")}
            >
              <Menu className="h-4 w-4" />
            </Button>
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
                attachments={attachments}
                attachmentsUploading={attachmentsUploading}
                attachmentError={attachmentError}
                onFilesSelected={handleFilesSelected}
                onRemoveAttachment={handleRemoveAttachment}
                disabled={!connected}
                submitDisabled={streaming || replayLoading || attachmentsUploading}
                isStreaming={streaming}
                placeholder={
                  connected ? t("Ask {{agent}} anything…", { agent: agentLabel }) : t("Connecting…")
                }
                targetLabel={agentLabel}
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
                  defaultWorkspacePath={defaultWorkspacePath}
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
            <ChatMessageList
              messages={messages}
              streaming={streaming}
              agentLabel={agentLabel}
              replayLoading={replayLoading}
              replayTitle={resumeReplay?.title}
              displaySettings={displaySettings}
            />

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
              attachments={attachments}
              attachmentsUploading={attachmentsUploading}
              attachmentError={attachmentError}
              onFilesSelected={handleFilesSelected}
              onRemoveAttachment={handleRemoveAttachment}
              disabled={!connected || replayLoading}
              submitDisabled={streaming || replayLoading || attachmentsUploading}
              isStreaming={streaming}
              placeholder={
                connected ? t("Message {{agent}}…", { agent: agentLabel }) : t("Connecting…")
              }
              targetLabel={agentLabel}
            />
          </>
        )}
      </div>
    </div>
  );
}

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_ATTACHMENT_PREFIXES = ["image/", "text/"];
const ALLOWED_ATTACHMENT_EXACT = ["application/pdf", "application/json"];

function isAllowedAttachment(file: File): boolean {
  if (file.size > MAX_ATTACHMENT_BYTES) return false;
  const mime = (file.type ?? "").trim().toLowerCase();
  if (!mime) return true; // server resolves from filename extension
  return (
    ALLOWED_ATTACHMENT_PREFIXES.some((prefix) => mime.startsWith(prefix)) ||
    ALLOWED_ATTACHMENT_EXACT.includes(mime)
  );
}

function describeRejection(
  file: File,
  t: (key: string, vars?: Record<string, string | number | null | undefined>) => string,
): string {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return t("{{name}} exceeds the {{limit}} MB upload limit.", {
      name: file.name,
      limit: MAX_ATTACHMENT_BYTES / (1024 * 1024),
    });
  }
  return t("{{name}} file type is not allowed.", { name: file.name });
}
