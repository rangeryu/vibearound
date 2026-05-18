"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  AgentInfo,
  LaunchSessionInfo,
  ProfileLaunchOption,
  WebVerboseSettings,
  WorkspaceItem,
} from "@va/client";
import { useI18n } from "@va/i18n";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_ATTACHMENT_BYTES, isAllowedAttachment } from "./attachmentTypes";
import { ChatInput } from "./ChatInput";
import { deleteCachedChatSession } from "./chatSessionCache";
import {
  chatSessionKey,
  ChatSessionSidebar,
  ALL_AGENTS_FILTER,
  type ChatSessionWorkspaceGroup,
} from "./ChatSessionSidebar";
import { ChatMessageList } from "./ChatMessageList";
import { NewChatAgentPicker } from "./NewChatAgentPicker";
import { NewChatHome } from "./NewChatHome";
import { NewChatWorkspacePicker } from "./NewChatWorkspacePicker";
import { PendingPermissions } from "./PendingPermissions";
import type {
  ChatAttachment,
  ChatMessage,
  ChatMeta,
  ChatSessionSelection,
  PendingPermission,
} from "./chatTypes";
import {
  type ResumeReplayState,
  useWebChatConnection,
} from "./useWebChatConnection";

interface ChatViewProps {
  webSettings: WebVerboseSettings;
  onStatusChange?: (status: ChatRuntimeStatus) => void;
  onOpenAppSidebar?: () => void;
}

const DIRECT_PROFILE_ID = "direct";
const LAUNCH_SELECTION_STORAGE_KEY = "vibearound.webChat.launchSelection";
const LAUNCH_SESSION_CACHE_STORAGE_KEY = "vibearound.webChat.launchSessions.v1";
const SESSION_SIDEBAR_WIDTH_STORAGE_KEY = "vibearound.webChat.sessionSidebarWidth";
const SESSION_SIDEBAR_DEFAULT_WIDTH = 256;
const SESSION_SIDEBAR_MIN_WIDTH = 224;
const SESSION_SIDEBAR_MAX_WIDTH = 420;
const INITIAL_RUNTIME_KEY = "draft:initial";

interface StoredLaunchSelection {
  agentId?: string;
  profileId?: string;
}

interface StoredLaunchSessionCache {
  scope: string;
  syncedAt: number;
  groups: ChatSessionWorkspaceGroup[];
}

interface ChatRuntimeSpec {
  agentId: string;
  profileId?: string;
  workspacePath?: string;
  launchSession?: LaunchSessionInfo;
  title?: string;
  initialResume?: {
    agentId: string;
    profileId?: string;
    launchSession: LaunchSessionInfo;
  };
}

interface ChatRuntimeSnapshot {
  messages: ChatMessage[];
  connected: boolean;
  streaming: boolean;
  meta: ChatMeta;
  agents: AgentInfo[];
  pendingPermissions: PendingPermission[];
  resumeReplay: ResumeReplayState | null;
}

interface ChatRuntimeActions {
  sendMessage: ReturnType<typeof useWebChatConnection>["sendMessage"];
  resumeSession: ReturnType<typeof useWebChatConnection>["resumeSession"];
  clearConversationView: ReturnType<typeof useWebChatConnection>["clearConversationView"];
  stopStreaming: ReturnType<typeof useWebChatConnection>["stopStreaming"];
  sendPermissionResponse: ReturnType<typeof useWebChatConnection>["sendPermissionResponse"];
  cancelPermissionRequest: ReturnType<typeof useWebChatConnection>["cancelPermissionRequest"];
}

const EMPTY_RUNTIME_SNAPSHOT: ChatRuntimeSnapshot = {
  messages: [],
  connected: false,
  streaming: false,
  meta: {},
  agents: [],
  pendingPermissions: [],
  resumeReplay: null,
};

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

function sessionSyncScope(
  agents: string[],
  workspaces: WorkspaceItem[],
  showArchived: boolean,
) {
  return `${agents.join(",")}\u0000${showArchived ? "archived" : "active"}\u0000${workspaces.map((workspace) => workspace.path).join("\u0000")}`;
}

function launchSessionKey(session: LaunchSessionInfo) {
  return `${session.agent_id}\u0000${session.workspace}\u0000${session.session_id}`;
}

function sameLaunchSession(a: LaunchSessionInfo, b: LaunchSessionInfo) {
  return (
    a.agent_id === b.agent_id &&
    a.session_id === b.session_id &&
    a.title === b.title &&
    a.workspace === b.workspace &&
    a.updated_at === b.updated_at &&
    a.short_id === b.short_id &&
    a.archived === b.archived
  );
}

function readCachedLaunchSessionGroups(
  scope: string,
  workspaces: WorkspaceItem[],
): ChatSessionWorkspaceGroup[] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(LAUNCH_SESSION_CACHE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredLaunchSessionCache>;
    if (parsed.scope !== scope || !Array.isArray(parsed.groups)) return undefined;
    return normalizeSessionGroups(parsed.groups, workspaces);
  } catch {
    return undefined;
  }
}

function writeCachedLaunchSessionGroups(
  scope: string,
  groups: ChatSessionWorkspaceGroup[],
) {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredLaunchSessionCache = {
      scope,
      syncedAt: Date.now(),
      groups,
    };
    window.localStorage.setItem(
      LAUNCH_SESSION_CACHE_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Session cache is an optimization; sync still works without storage.
  }
}

function normalizeSessionGroups(
  groups: ChatSessionWorkspaceGroup[],
  workspaces: WorkspaceItem[],
): ChatSessionWorkspaceGroup[] {
  const workspaceByPath = new Map(workspaces.map((workspace) => [workspace.path, workspace]));
  return groups
    .flatMap((group) => {
      const path = group.workspace?.path;
      if (typeof path !== "string") return [];
      const workspace = workspaceByPath.get(path) ?? group.workspace;
      const sessions = Array.isArray(group.sessions)
        ? group.sessions.filter(isLaunchSessionInfo)
        : [];
      return [{ workspace, sessions }];
    })
    .filter((group) =>
      workspaces.length === 0 ||
      workspaces.some((workspace) => workspace.path === group.workspace.path),
    );
}

function isLaunchSessionInfo(value: unknown): value is LaunchSessionInfo {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LaunchSessionInfo>;
  return (
    typeof item.agent_id === "string" &&
    typeof item.session_id === "string" &&
    typeof item.title === "string" &&
    typeof item.workspace === "string" &&
    typeof item.updated_at === "number" &&
    typeof item.short_id === "string" &&
    typeof item.archived === "boolean"
  );
}

function mergeSessionGroupUpdates(
  currentGroups: ChatSessionWorkspaceGroup[],
  updatedGroups: ChatSessionWorkspaceGroup[],
  workspaces: WorkspaceItem[],
  updatedAgentIds: string[],
): ChatSessionWorkspaceGroup[] {
  const workspaceByPath = new Map(workspaces.map((workspace) => [workspace.path, workspace]));
  const updatedAgents = new Set(updatedAgentIds);
  const groups = new Map<string, ChatSessionWorkspaceGroup>();
  for (const workspace of workspaces) {
    groups.set(workspace.path, { workspace, sessions: [] });
  }
  for (const group of currentGroups) {
    const workspace =
      workspaceByPath.get(group.workspace.path) ?? group.workspace;
    groups.set(workspace.path, { workspace, sessions: group.sessions });
  }

  for (const group of normalizeSessionGroups(updatedGroups, workspaces)) {
    const current = groups.get(group.workspace.path) ?? {
      workspace: workspaceByPath.get(group.workspace.path) ?? group.workspace,
      sessions: [],
    };
    const sessions = new Map<string, LaunchSessionInfo>();
    for (const session of current.sessions) {
      if (!updatedAgents.has(session.agent_id)) {
        sessions.set(launchSessionKey(session), session);
      }
    }
    for (const session of group.sessions) {
      const key = launchSessionKey(session);
      const existing = sessions.get(key);
      sessions.set(key, existing && sameLaunchSession(existing, session) ? existing : session);
    }
    const nextSessions = Array.from(sessions.values());
    groups.set(group.workspace.path, {
      workspace: current.workspace,
      sessions:
        nextSessions.length === current.sessions.length &&
        nextSessions.every((session, index) => session === current.sessions[index])
          ? current.sessions
          : nextSessions,
    });
  }
  return Array.from(groups.values());
}

function ChatRuntimeHost({
  runtimeKey,
  initialResume,
  onSnapshot,
  onActions,
  onAgentSelected,
}: {
  runtimeKey: string;
  initialResume?: ChatRuntimeSpec["initialResume"];
  onSnapshot: (runtimeKey: string, snapshot: ChatRuntimeSnapshot) => void;
  onActions: (runtimeKey: string, actions: ChatRuntimeActions | null) => void;
  onAgentSelected: (
    runtimeKey: string,
    agentId: string,
    source: "config" | "system",
  ) => void;
}) {
  const initialResumeStartedRef = useRef(false);
  const handleAgentSelected = useCallback(
    (agentId: string, source: "config" | "system") =>
      onAgentSelected(runtimeKey, agentId, source),
    [onAgentSelected, runtimeKey],
  );
  const connection = useWebChatConnection({ onAgentSelected: handleAgentSelected });

  useEffect(() => {
    onSnapshot(runtimeKey, {
      messages: connection.messages,
      connected: connection.connected,
      streaming: connection.streaming,
      meta: connection.meta,
      agents: connection.agents,
      pendingPermissions: connection.pendingPermissions,
      resumeReplay: connection.resumeReplay,
    });
  }, [
    connection.agents,
    connection.connected,
    connection.messages,
    connection.meta,
    connection.pendingPermissions,
    connection.resumeReplay,
    connection.streaming,
    onSnapshot,
    runtimeKey,
  ]);

  useEffect(() => {
    onActions(runtimeKey, {
      sendMessage: connection.sendMessage,
      resumeSession: connection.resumeSession,
      clearConversationView: connection.clearConversationView,
      stopStreaming: connection.stopStreaming,
      sendPermissionResponse: connection.sendPermissionResponse,
      cancelPermissionRequest: connection.cancelPermissionRequest,
    });
    return () => onActions(runtimeKey, null);
  }, [
    connection.cancelPermissionRequest,
    connection.clearConversationView,
    connection.resumeSession,
    connection.sendMessage,
    connection.sendPermissionResponse,
    connection.stopStreaming,
    onActions,
    runtimeKey,
  ]);

  useEffect(() => {
    if (!initialResume || initialResumeStartedRef.current || !connection.connected) {
      return;
    }
    initialResumeStartedRef.current = true;
    connection.resumeSession(initialResume);
  }, [connection.connected, connection.resumeSession, initialResume]);

  return null;
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
  const [attachmentsUploadingCount, setAttachmentsUploadingCount] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string | undefined>();
  const [selectedAgent, setSelectedAgent] = useState<string>(
    storedLaunchSelection.agentId ?? "claude",
  );
  const [sidebarAgentFilter, setSidebarAgentFilter] = useState<string>(ALL_AGENTS_FILTER);
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
  const [syncedLaunchSessionGroups, setSyncedLaunchSessionGroups] = useState<
    ChatSessionWorkspaceGroup[]
  >([]);
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
  const syncedSessionScopeRef = useRef<string | undefined>(undefined);
  const syncedLaunchSessionAgentsRef = useRef<Set<string>>(new Set());
  const sessionSyncRequestIdRef = useRef(0);
  const [runtimeKeys, setRuntimeKeys] = useState<string[]>([INITIAL_RUNTIME_KEY]);
  const [activeRuntimeKey, setActiveRuntimeKey] = useState(INITIAL_RUNTIME_KEY);
  const activeRuntimeKeyRef = useRef(activeRuntimeKey);
  const [runtimeSpecs, setRuntimeSpecs] = useState<Record<string, ChatRuntimeSpec>>(
    () => ({
      [INITIAL_RUNTIME_KEY]: {
        agentId: storedLaunchSelection.agentId ?? "claude",
        profileId: storedLaunchSelection.profileId ?? DIRECT_PROFILE_ID,
      },
    }),
  );
  const [runtimeSnapshots, setRuntimeSnapshots] = useState<
    Record<string, ChatRuntimeSnapshot>
  >({});
  const runtimeActionsRef = useRef<Record<string, ChatRuntimeActions>>({});

  useEffect(() => {
    activeRuntimeKeyRef.current = activeRuntimeKey;
  }, [activeRuntimeKey]);

  const handleSocketAgentSelected = useCallback(
    (runtimeKey: string, agentId: string, source: "config" | "system") => {
      if (runtimeKey !== activeRuntimeKeyRef.current) return;
      if (source === "config" && storedLaunchSelection.agentId) return;
      setSelectedAgent(agentId);
    },
    [storedLaunchSelection.agentId],
  );

  const handleRuntimeSnapshot = useCallback(
    (runtimeKey: string, snapshot: ChatRuntimeSnapshot) => {
      setRuntimeSnapshots((prev) => ({ ...prev, [runtimeKey]: snapshot }));
    },
    [],
  );

  const handleRuntimeActions = useCallback(
    (runtimeKey: string, actions: ChatRuntimeActions | null) => {
      if (actions) {
        runtimeActionsRef.current[runtimeKey] = actions;
        return;
      }
      delete runtimeActionsRef.current[runtimeKey];
    },
    [],
  );

  const activeRuntime = runtimeSnapshots[activeRuntimeKey] ?? EMPTY_RUNTIME_SNAPSHOT;
  const activeRuntimeActions = runtimeActionsRef.current[activeRuntimeKey];
  const messages = activeRuntime.messages;
  const connected = activeRuntime.connected;
  const streaming = activeRuntime.streaming;
  const meta = activeRuntime.meta;
  const agents = useMemo(
    () =>
      Object.values(runtimeSnapshots).find((snapshot) => snapshot.agents.length > 0)
        ?.agents ?? [],
    [runtimeSnapshots],
  );
  const pendingPermissions = activeRuntime.pendingPermissions;
  const resumeReplay = activeRuntime.resumeReplay;
  const sendMessage = activeRuntimeActions?.sendMessage;
  const stopStreaming = activeRuntimeActions?.stopStreaming;
  const sendPermissionResponse = activeRuntimeActions?.sendPermissionResponse;
  const cancelPermissionRequest = activeRuntimeActions?.cancelPermissionRequest;

  const launchSessionGroups = useMemo(
    () =>
      syncedLaunchSessionGroups.map((group) => ({
        ...group,
        sessions:
          sidebarAgentFilter === ALL_AGENTS_FILTER
            ? group.sessions
            : group.sessions.filter((session) => session.agent_id === sidebarAgentFilter),
      })),
    [sidebarAgentFilter, syncedLaunchSessionGroups],
  );
  const launchSessions = useMemo(
    () => syncedLaunchSessionGroups.flatMap((group) => group.sessions),
    [syncedLaunchSessionGroups],
  );
  const selectedAgentInfo = agents.find((agent) => agent.id === selectedAgent);
  const agentLabel = selectedAgentInfo?.name ?? getAgentDisplayName(selectedAgent);
  const selectedProfileId = profileSelections[selectedAgent] ?? DIRECT_PROFILE_ID;
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.path === selectedWorkspacePath,
  );
  const sessionSelection = sessionSelections[selectedAgent] ?? { kind: "current" };
  const selectedLaunchSession =
    sessionSelection.kind === "resume" &&
    selectedLaunchSessions[selectedAgent]?.agent_id === selectedAgent &&
    selectedLaunchSessions[selectedAgent]?.session_id === sessionSelection.sessionId
      ? selectedLaunchSessions[selectedAgent]
      : sessionSelection.kind === "resume"
        ? launchSessions.find(
            (session) =>
              session.agent_id === selectedAgent &&
              session.session_id === sessionSelection.sessionId,
          )
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
  const runtimeLaunchSessions = useMemo(() => {
    return Object.entries(runtimeSpecs).flatMap(([runtimeKey, spec]) => {
      const snapshot = runtimeSnapshots[runtimeKey];
      if (!snapshot || (!snapshot.streaming && !snapshot.resumeReplay)) return [];
      const sessionId = spec.launchSession?.session_id ?? snapshot.meta.sessionId;
      const workspacePath =
        spec.launchSession?.workspace ??
        spec.workspacePath ??
        selectedWorkspace?.path ??
        defaultWorkspacePath;
      if (!sessionId || !workspacePath) return [];
      const title =
        spec.launchSession?.title ??
        spec.title ??
        (snapshot.resumeReplay?.title || t("Current session"));
      return [
        {
          agent_id: spec.launchSession?.agent_id ?? spec.agentId,
          session_id: sessionId,
          title,
          workspace: workspacePath,
          updated_at: spec.launchSession?.updated_at ?? snapshot.resumeReplay?.updatedAt ?? 0,
          short_id: spec.launchSession?.short_id ?? sessionId.slice(0, 8),
          archived: false,
        } satisfies LaunchSessionInfo,
      ];
    });
  }, [
    defaultWorkspacePath,
    runtimeSnapshots,
    runtimeSpecs,
    selectedWorkspace?.path,
    t,
  ]);
  const visibleRuntimeLaunchSessions = useMemo(
    () =>
      sidebarAgentFilter === ALL_AGENTS_FILTER
        ? runtimeLaunchSessions
        : runtimeLaunchSessions.filter(
            (session) => session.agent_id === sidebarAgentFilter,
          ),
    [runtimeLaunchSessions, sidebarAgentFilter],
  );
  const runtimeBusySessionKeys = useMemo(
    () =>
      new Set(visibleRuntimeLaunchSessions.map((session) => chatSessionKey(session))),
    [visibleRuntimeLaunchSessions],
  );
  const displayLaunchSessionGroups = useMemo(() => {
    if (visibleRuntimeLaunchSessions.length === 0) return launchSessionGroups;
    const groupsByWorkspace = new Map<string, ChatSessionWorkspaceGroup>();
    for (const group of launchSessionGroups) {
      groupsByWorkspace.set(group.workspace.path, {
        workspace: group.workspace,
        sessions: [...group.sessions],
      });
    }
    for (const session of visibleRuntimeLaunchSessions) {
      const workspace =
        groupsByWorkspace.get(session.workspace)?.workspace ??
        workspaces.find((item) => item.path === session.workspace) ?? {
          path: session.workspace,
          is_default: session.workspace === defaultWorkspacePath,
          is_builtin: false,
        };
      const group = groupsByWorkspace.get(session.workspace) ?? {
        workspace,
        sessions: [],
      };
      const existingIndex = group.sessions.findIndex(
        (item) => chatSessionKey(item) === chatSessionKey(session),
      );
      if (existingIndex >= 0) {
        group.sessions[existingIndex] = {
          ...group.sessions[existingIndex],
          ...session,
        };
      } else {
        group.sessions.unshift(session);
      }
      groupsByWorkspace.set(session.workspace, group);
    }
    return Array.from(groupsByWorkspace.values());
  }, [
    defaultWorkspacePath,
    launchSessionGroups,
    visibleRuntimeLaunchSessions,
    workspaces,
  ]);

  const createDraftRuntime = useCallback((agentId: string, workspacePath?: string) => {
    const runtimeKey = `draft:${agentId}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2)}`;
    setRuntimeSpecs((prev) => ({
      ...prev,
      [runtimeKey]: {
        agentId,
        profileId: profileSelections[agentId] ?? DIRECT_PROFILE_ID,
        workspacePath,
      },
    }));
    setRuntimeKeys((prev) => [...prev, runtimeKey]);
    setActiveRuntimeKey(runtimeKey);
    setSelectedAgent(agentId);
    if (workspacePath) setSelectedWorkspacePath(workspacePath);
    return runtimeKey;
  }, [profileSelections]);

  const activateRuntimeForSession = useCallback(
    (session: LaunchSessionInfo) => {
      const existingRuntime = Object.entries(runtimeSpecs).find(([runtimeKey, spec]) => {
        const snapshot = runtimeSnapshots[runtimeKey];
        const sessionId = spec.launchSession?.session_id ?? snapshot?.meta.sessionId;
        const workspace =
          spec.launchSession?.workspace ??
          spec.workspacePath ??
          snapshot?.resumeReplay?.workspace;
        return (
          spec.agentId === session.agent_id &&
          sessionId === session.session_id &&
          workspace === session.workspace
        );
      });
      if (existingRuntime) {
        const [runtimeKey] = existingRuntime;
        setRuntimeSpecs((prev) => ({
          ...prev,
          [runtimeKey]: {
            ...(prev[runtimeKey] ?? {
              agentId: session.agent_id,
              profileId: profileSelections[session.agent_id] ?? DIRECT_PROFILE_ID,
            }),
            agentId: session.agent_id,
            profileId:
              prev[runtimeKey]?.profileId ??
              profileSelections[session.agent_id] ??
              DIRECT_PROFILE_ID,
            workspacePath: session.workspace,
            launchSession: session,
            title: session.title,
          },
        }));
        setActiveRuntimeKey(runtimeKey);
        setSelectedAgent(session.agent_id);
        setSelectedWorkspacePath(session.workspace);
        return runtimeKey;
      }

      const runtimeKey = `session:${chatSessionKey(session)}`;
      setRuntimeSpecs((prev) =>
        prev[runtimeKey]
          ? prev
          : {
              ...prev,
              [runtimeKey]: {
                agentId: session.agent_id,
                profileId: profileSelections[session.agent_id] ?? DIRECT_PROFILE_ID,
                workspacePath: session.workspace,
                launchSession: session,
                title: session.title,
                initialResume: {
                  agentId: session.agent_id,
                  profileId: profileSelections[session.agent_id] ?? DIRECT_PROFILE_ID,
                  launchSession: session,
                },
              },
            },
      );
      setRuntimeKeys((prev) =>
        prev.includes(runtimeKey) ? prev : [...prev, runtimeKey],
      );
      setActiveRuntimeKey(runtimeKey);
      setSelectedAgent(session.agent_id);
      setSelectedWorkspacePath(session.workspace);
      return runtimeKey;
    },
    [profileSelections, runtimeSnapshots, runtimeSpecs],
  );

  const removeRuntime = useCallback((runtimeKey: string) => {
    setRuntimeKeys((prev) => prev.filter((key) => key !== runtimeKey));
    setRuntimeSpecs((prev) => {
      const next = { ...prev };
      delete next[runtimeKey];
      return next;
    });
    setRuntimeSnapshots((prev) => {
      const next = { ...prev };
      delete next[runtimeKey];
      return next;
    });
    delete runtimeActionsRef.current[runtimeKey];
  }, []);

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
      if (current === ALL_AGENTS_FILTER || agents.some((agent) => agent.id === current)) {
        return current;
      }
      return ALL_AGENTS_FILTER;
    });
  }, [agents]);

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

  const syncLaunchSessions = useCallback(
    async (options?: { force?: boolean; agentIds?: string[] }) => {
      const agentIds = agents.map((agent) => agent.id);
      const requestedAgentIds =
        options?.agentIds?.filter((agentId) => agentIds.includes(agentId)) ?? agentIds;
      if (agentIds.length === 0 || workspacesLoading || workspaces.length === 0) {
        syncedSessionScopeRef.current = undefined;
        syncedLaunchSessionAgentsRef.current = new Set();
        setSyncedLaunchSessionGroups([]);
        setSessionsLoading(false);
        return;
      }
      if (requestedAgentIds.length === 0) return;

      const scope = sessionSyncScope(agentIds, workspaces, webSettings.show_archived);
      const previousScope = syncedSessionScopeRef.current;
      if (!options?.force && previousScope === scope) return;
      syncedSessionScopeRef.current = scope;
      const canMergeCurrentGroups = previousScope === scope;
      if (!canMergeCurrentGroups) {
        syncedLaunchSessionAgentsRef.current = new Set();
      }

      const cachedGroups = canMergeCurrentGroups
        ? undefined
        : readCachedLaunchSessionGroups(scope, workspaces);
      if (cachedGroups) {
        syncedLaunchSessionAgentsRef.current = new Set(agentIds);
        setSyncedLaunchSessionGroups((currentGroups) =>
          mergeSessionGroupUpdates(
            canMergeCurrentGroups ? currentGroups : [],
            cachedGroups,
            workspaces,
            agentIds,
          ),
        );
      } else if (!canMergeCurrentGroups) {
        setSyncedLaunchSessionGroups([]);
      }

      const requestId = ++sessionSyncRequestIdRef.current;
      setSessionsLoading(true);
      try {
        const freshGroups = await Promise.all(
          workspaces.map(async (workspace) => {
            const sessionGroups = await Promise.all(
              requestedAgentIds.map(async (agentId) => {
                try {
                  return await getLaunchSessions(
                    agentId,
                    webSettings.show_archived,
                    workspace.path,
                  );
                } catch (error) {
                  console.warn(
                    "[ChatView] failed to sync launch sessions for workspace:",
                    workspace.path,
                    agentId,
                    error,
                  );
                  return [];
                }
              }),
            );
            return {
              workspace,
              sessions: sessionGroups.flat(),
            };
          }),
        );
        if (sessionSyncRequestIdRef.current !== requestId) return;
        setSyncedLaunchSessionGroups((currentGroups) => {
          const baseGroups =
            cachedGroups && !canMergeCurrentGroups
              ? mergeSessionGroupUpdates([], cachedGroups, workspaces, agentIds)
              : currentGroups;
          const mergedGroups = mergeSessionGroupUpdates(
            baseGroups,
            freshGroups,
            workspaces,
            requestedAgentIds,
          );
          syncedLaunchSessionAgentsRef.current = new Set([
            ...syncedLaunchSessionAgentsRef.current,
            ...requestedAgentIds,
          ]);
          if (agentIds.every((agentId) => syncedLaunchSessionAgentsRef.current.has(agentId))) {
            writeCachedLaunchSessionGroups(scope, mergedGroups);
          }
          return mergedGroups;
        });
      } catch (error) {
        console.warn("[ChatView] failed to sync launch sessions:", error);
      } finally {
        if (sessionSyncRequestIdRef.current === requestId) {
          setSessionsLoading(false);
        }
      }
    },
    [agents, webSettings.show_archived, workspaces, workspacesLoading],
  );

  useEffect(() => {
    void syncLaunchSessions();
  }, [syncLaunchSessions]);

  const handleLaunchChange = useCallback((agentId: string, profileId?: string) => {
    setSelectedAgent(agentId);
    setProfileSelections((prev) => {
      return { ...prev, [agentId]: profileId ?? DIRECT_PROFILE_ID };
    });
  }, []);

  const handleSidebarAgentFilterChange = useCallback((agentId: string) => {
    setSidebarAgentFilter(agentId);
    void syncLaunchSessions({
      force: true,
      agentIds: agentId === ALL_AGENTS_FILTER ? undefined : [agentId],
    });
  }, [syncLaunchSessions]);

  const handleSyncSessions = useCallback(() => {
    void syncLaunchSessions({ force: true });
  }, [syncLaunchSessions]);

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
      const targetAgentId =
        session?.agent_id ??
        (sidebarAgentFilter === ALL_AGENTS_FILTER ? selectedAgent : sidebarAgentFilter);
      if (selection.kind === "new") {
        setSessionSelections((prev) => ({ ...prev, [targetAgentId]: selection }));
        setSelectedLaunchSessions((prev) => {
          const next = { ...prev };
          delete next[targetAgentId];
          return next;
        });
        createDraftRuntime(targetAgentId, selectedWorkspace?.path);
        setAttachments([]);
        setAttachmentError(undefined);
        return;
      }
      if (selection.kind !== "resume") return;

      const launchSession = session ?? launchSessions.find(
        (item) =>
          item.agent_id === targetAgentId && item.session_id === selection.sessionId,
      );
      if (!launchSession) return;

      setSessionSelections((prev) => ({ ...prev, [launchSession.agent_id]: selection }));
      setSelectedLaunchSessions((prev) => ({
        ...prev,
        [launchSession.agent_id]: launchSession,
      }));
      setAttachments([]);
      setAttachmentError(undefined);
      activateRuntimeForSession(launchSession);
    },
    [
      activateRuntimeForSession,
      createDraftRuntime,
      launchSessions,
      selectedAgent,
      sidebarAgentFilter,
      selectedWorkspace?.path,
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
        const runtimeEntry = Object.entries(runtimeSpecs).find(([runtimeKey, spec]) => {
          const snapshot = runtimeSnapshots[runtimeKey];
          const sessionId = spec.launchSession?.session_id ?? snapshot?.meta.sessionId;
          const workspace =
            spec.launchSession?.workspace ?? spec.workspacePath ?? defaultWorkspacePath;
          return (
            spec.agentId === session.agent_id &&
            sessionId === session.session_id &&
            workspace === session.workspace
          );
        });
        if (runtimeEntry) {
          runtimeActionsRef.current[runtimeEntry[0]]?.stopStreaming();
        }
        await archiveLaunchSession(session.agent_id, session.session_id, session.workspace);
        void deleteCachedChatSession({
          agentId: session.agent_id,
          workspace: session.workspace,
          sessionId: session.session_id,
        }).catch((error) => {
          console.warn("[ChatView] failed to delete archived session cache:", error);
        });
        setSyncedLaunchSessionGroups((prev) => {
          const next = prev.map((group) => ({
            ...group,
            sessions: webSettings.show_archived
              ? group.sessions.map((item) =>
                  item.agent_id === session.agent_id &&
                  item.session_id === session.session_id
                    ? { ...item, archived: true }
                    : item,
                )
              : group.sessions.filter(
                  (item) =>
                    item.agent_id !== session.agent_id ||
                    item.session_id !== session.session_id,
                ),
          }));
          if (syncedSessionScopeRef.current) {
            writeCachedLaunchSessionGroups(syncedSessionScopeRef.current, next);
          }
          return next;
        });
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
          createDraftRuntime(session.agent_id, session.workspace);
        }
        if (runtimeEntry) {
          removeRuntime(runtimeEntry[0]);
        }
      } catch (error) {
        console.warn("[ChatView] failed to archive launch session:", error);
      } finally {
        setArchivingSessionId(undefined);
      }
    },
    [
      createDraftRuntime,
      defaultWorkspacePath,
      removeRuntime,
      runtimeSnapshots,
      runtimeSpecs,
      selectedAgent,
      sessionSelection,
      webSettings.show_archived,
    ],
  );

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const accepted = files.filter(isAllowedAttachment);
    const rejected = files.filter((file) => !isAllowedAttachment(file));
    if (rejected.length > 0) {
      setAttachmentError(describeRejections(rejected, t));
    }
    if (accepted.length === 0) {
      return;
    }
    setAttachmentsUploading(true);
    setAttachmentsUploadingCount(accepted.length);
    if (rejected.length === 0) {
      setAttachmentError(undefined);
    }
    try {
      const results = await Promise.allSettled(
        accepted.map((file) => uploadChatFile(file)),
      );
      const uploaded = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = results.filter((result) => result.status === "rejected");
      if (uploaded.length > 0) {
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
      }
      if (failed.length > 0) {
        failed.forEach((result) => {
          if (result.status === "rejected") {
            console.warn("[ChatView] failed to upload attachment:", result.reason);
          }
        });
        setAttachmentError(
          t("{{count}} files failed to upload.", { count: failed.length }),
        );
      }
    } catch (error) {
      console.warn("[ChatView] failed to upload attachment:", error);
      setAttachmentError(
        error instanceof Error ? error.message : t("Failed to upload attachment"),
      );
    } finally {
      setAttachmentsUploading(false);
      setAttachmentsUploadingCount(0);
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
    if (!sendMessage) return;
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
    setRuntimeSpecs((prev) => ({
      ...prev,
      [activeRuntimeKey]: {
        ...(prev[activeRuntimeKey] ?? { agentId: selectedAgent }),
        agentId: selectedAgent,
        profileId: selectedProfileId,
        workspacePath: selectedWorkspace?.path,
        launchSession: selectedLaunchSession,
        title:
          text ||
          attachments[0]?.name ||
          selectedLaunchSession?.title ||
          t("Current session"),
      },
    }));
    if (sessionSelection.kind === "new") {
      setSessionSelections((prev) => ({ ...prev, [selectedAgent]: { kind: "current" } }));
    }
  }, [
    activeRuntimeKey,
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
    t,
  ]);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {runtimeKeys.map((runtimeKey) => (
        <ChatRuntimeHost
          key={runtimeKey}
          runtimeKey={runtimeKey}
          initialResume={runtimeSpecs[runtimeKey]?.initialResume}
          onSnapshot={handleRuntimeSnapshot}
          onActions={handleRuntimeActions}
          onAgentSelected={handleSocketAgentSelected}
        />
      ))}
      {showSessionSidebar && (
        <div
          className="relative hidden h-full shrink-0 md:flex"
          style={{ width: sessionSidebarWidth }}
        >
          <ChatSessionSidebar
            workspaceGroups={displayLaunchSessionGroups}
            agents={agents}
            selectedAgentFilter={sidebarAgentFilter}
            activeAgentId={selectedAgent}
            className="flex w-full"
            style={{ width: "100%" }}
            sessionsLoading={sidebarSessionsLoading}
            loadingSessionId={resumeReplay?.sessionId}
            loadingSessionKeys={runtimeBusySessionKeys}
            archivingSessionId={archivingSessionId}
            sessionSelection={sessionSelection}
            onSyncSessions={handleSyncSessions}
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
              workspaceGroups={displayLaunchSessionGroups}
              agents={agents}
              selectedAgentFilter={sidebarAgentFilter}
              activeAgentId={selectedAgent}
              variant="mobile"
              sessionsLoading={sidebarSessionsLoading}
              loadingSessionId={resumeReplay?.sessionId}
              loadingSessionKeys={runtimeBusySessionKeys}
              archivingSessionId={archivingSessionId}
              sessionSelection={sessionSelection}
              onSyncSessions={handleSyncSessions}
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
              <BrandIcon
                kind="cli"
                id={selectedAgent}
                label={agentLabel}
                className="h-4 w-4"
              />
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
                attachmentsUploadingCount={attachmentsUploadingCount}
                attachmentError={attachmentError}
                onFilesSelected={handleFilesSelected}
                onRemoveAttachment={handleRemoveAttachment}
                disabled={!connected}
                submitDisabled={streaming || replayLoading || attachmentsUploading}
                isStreaming={streaming}
                sendWithModifierEnter={webSettings.send_with_modifier_enter}
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
              onRespond={(requestId, optionId) =>
                sendPermissionResponse?.(requestId, optionId)
              }
              onCancel={(requestId) => cancelPermissionRequest?.(requestId)}
            />

            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              onStop={stopStreaming}
              attachments={attachments}
              attachmentsUploading={attachmentsUploading}
              attachmentsUploadingCount={attachmentsUploadingCount}
              attachmentError={attachmentError}
              onFilesSelected={handleFilesSelected}
              onRemoveAttachment={handleRemoveAttachment}
              disabled={!connected || replayLoading}
              submitDisabled={streaming || replayLoading || attachmentsUploading}
              isStreaming={streaming}
              sendWithModifierEnter={webSettings.send_with_modifier_enter}
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

function describeRejections(
  files: File[],
  t: (key: string, vars?: Record<string, string | number | null | undefined>) => string,
): string {
  const [first, ...rest] = files;
  if (!first) return "";
  const message = describeRejection(first, t);
  if (rest.length === 0) return message;
  return t("{{message}} {{count}} more files were skipped.", {
    message,
    count: rest.length,
  });
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
