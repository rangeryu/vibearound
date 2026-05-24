import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  FolderOpen,
  MessageCircle,
  Rocket,
  Terminal,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { BrandIcon } from "@/components/brand-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AgentRailButton,
  BridgeBadge,
  TooltipButton,
} from "./LaunchBuilderPrimitives";
import {
  ProfilePanel,
  SessionPanel,
  WorkspacePanel,
} from "./LaunchBuilderPanels";
import {
  deleteProfile,
  getLauncherPreferences,
  launchDirect,
  launchDirectResume,
  launchProfile,
  launchProfileResume,
  listAgents,
  listLaunchSessions,
  listLauncherWorkspaces,
  listProfiles,
  removeLauncherWorkspace,
  reorderLauncherWorkspaces,
  reorderProfiles,
  setProfileConnection,
  setLauncherAgentProfile,
  setLauncherDefault,
  setLauncherSelectedAgent,
  setLauncherTerminal,
  setLauncherWorkspace,
  type AgentSummary,
  type LaunchSessionSummary,
  type LauncherPreferences,
  type WorkspaceOption,
} from "./api";
import {
  agentLabel,
  agentConnectionDef,
  agentProfileId,
  agentSupportsSessionResume,
  agentWorkspace,
  apiTypeProtocolDisplayLabel,
  currentTerminal,
  currentWorkspace,
  isBridgeAgent,
  isSelectionLaunchable,
  isSortableWorkspace,
  mergeOrderedSubset,
  moveItemBefore,
  profileById,
  profileSupportsAgent,
  profileSummary,
  resolveSelectedSession,
  selectionUnavailableReason,
  type ProfileChoice,
  type SessionChoice,
} from "./launchModel";
import { resolveProfileConnection } from "./connections";
import type { ConnectionAgentId, ProfileSummary } from "./types";

type SelectorPopupId = "profile" | "workspace" | "session";

const AGENT_ORDER = [
  "codex",
  "claude",
  "pi",
  "gemini",
  "cursor",
  "kiro",
  "qwen-code",
  "opencode",
];
interface Props {
  profiles: ProfileSummary[];
  prefs: LauncherPreferences | null;
  onPrefsChange: (prefs: LauncherPreferences) => void;
  onProfilesChange: (profiles: ProfileSummary[]) => void;
  onNewProfile: () => void;
  onEditProfile: (profile: ProfileSummary) => void;
  onConnectionSettings: (
    profile: ProfileSummary,
    agentId: ConnectionAgentId,
  ) => void;
  onError: (message: string | null) => void;
  onToast: (message: string | null) => void;
}

function SelectorPopup({
  id,
  openSelector,
  onOpenChange,
  align = "start",
  widthClassName,
  widthPx,
  trigger,
  children,
}: {
  id: SelectorPopupId;
  openSelector: SelectorPopupId | null;
  onOpenChange: (id: SelectorPopupId | null) => void;
  align?: "start" | "end";
  widthClassName: string;
  widthPx: number;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const open = openSelector === id;
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) {
        onOpenChange(null);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(null);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onOpenChange, open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    function updatePosition() {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;

      const gutter = 8;
      const popupWidth = Math.min(widthPx, window.innerWidth - gutter * 2);
      const rawLeft = align === "end" ? rect.right - popupWidth : rect.left;
      const maxLeft = Math.max(gutter, window.innerWidth - popupWidth - gutter);
      setPosition({
        left: Math.min(Math.max(rawLeft, gutter), maxLeft),
        top: rect.bottom + gutter,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, open, widthPx]);

  return (
    <div ref={ref} className="relative min-w-0">
      {trigger}
      {open && position && (
        <div
          className={`fixed z-50 ${widthClassName}`}
          style={{ left: position.left, top: position.top }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function LaunchSummaryPill({
  active = false,
  disabled = false,
  label,
  title,
  detail,
  icon,
  className = "",
  chevron = false,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  title: string;
  detail?: string;
  icon?: ReactNode;
  className?: string;
  chevron?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
          {icon}
        </span>
      )}
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate font-semibold text-foreground">
        {title}
      </span>
      {detail && (
        <span className="min-w-0 truncate text-muted-foreground">
          <span className="px-0.5">·</span>
          {detail}
        </span>
      )}
      {chevron && (
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
    </>
  );
  const baseClassName = `flex h-9 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md border bg-transparent px-2.5 text-xs transition-colors ${
    disabled
      ? "cursor-not-allowed border-border/70 opacity-60"
      : active
        ? "border-primary/45"
      : onClick
        ? "border-border/70 hover:border-primary/35"
        : "border-border/70"
  } ${className}`;

  if (!onClick) {
    return <div className={baseClassName}>{content}</div>;
  }

  return (
    <button
      type="button"
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={baseClassName}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      {content}
    </button>
  );
}

function AgentSummaryHeader({
  agentId,
  agentLabelText,
  children,
}: {
  agentId: string;
  agentLabelText: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center text-primary">
        <BrandIcon
          kind="cli"
          id={agentId}
          label={agentLabelText}
          framed={false}
          className="h-12 w-12"
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[17px] font-semibold leading-tight">
          {agentLabelText}
        </span>
        {children}
      </span>
    </div>
  );
}

function ProfileInfoRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-t border-border/60 px-3 py-2">
      <div className="text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 text-[12px] text-foreground">{children}</div>
    </div>
  );
}

function ProfileInfoPanel({
  agentId,
  prefs,
  profile,
  summary,
}: {
  agentId: string;
  prefs: LauncherPreferences;
  profile: ProfileSummary | null;
  summary: { title: string; detail: string; bridge: boolean; route: string };
}) {
  const { t } = useI18n();
  const connection =
    profile && isBridgeAgent(agentId)
      ? resolveProfileConnection(
          profile,
          prefs.profileConnections,
          agentConnectionDef(agentId),
        )
      : null;
  const selectedConnection = connection?.selected ?? null;
  const launchTarget = profile?.launchTargets.find(
    (target) => target.id === agentId,
  );
  const bridgeStatus = selectedConnection
    ? selectedConnection.status === "via_bridge"
      ? t("API bridge on")
      : selectedConnection.status === "native"
        ? t("Native")
        : t("Unsupported")
    : t("Disabled");
  const modelEntries =
    selectedConnection?.status === "via_bridge"
      ? selectedConnection.models.filter((model) => model.upstreamModel)
      : [];

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 px-3 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
          {profile ? (
            <BrandIcon
              kind="provider"
              id={profile.provider}
              label={profile.providerLabel}
              fallback={profile.providerIcon}
              framed={false}
              className="h-8 w-8"
            />
          ) : (
            <Terminal className="h-5 w-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-semibold">
              {summary.title}
            </span>
            {summary.bridge && <BridgeBadge />}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {profile ? profile.providerLabel : t("Use existing CLI login")}
          </span>
        </span>
      </div>
      {profile ? (
        <>
          <ProfileInfoRow label={t("Provider")}>
            <span className="truncate">{profile.providerLabel}</span>
          </ProfileInfoRow>
          <ProfileInfoRow label={t("API kinds")}>
            <span className="truncate">
              {profile.apiTypes.map(apiTypeProtocolDisplayLabel).join(", ")}
            </span>
          </ProfileInfoRow>
          <ProfileInfoRow label={t("Route")}>
            <span className="block truncate" title={summary.route}>
              {summary.route}
            </span>
          </ProfileInfoRow>
          <ProfileInfoRow label={t("API bridge")}>
            <span className="truncate">{bridgeStatus}</span>
          </ProfileInfoRow>
          {selectedConnection && (
            <ProfileInfoRow label={t("Client API")}>
              <span className="truncate">
                {apiTypeProtocolDisplayLabel(selectedConnection.apiType)}
              </span>
            </ProfileInfoRow>
          )}
          {selectedConnection?.targetApiType && (
            <ProfileInfoRow label={t("Target API")}>
              <span className="truncate">
                {profile.providerLabel}{" "}
                {apiTypeProtocolDisplayLabel(selectedConnection.targetApiType)}
              </span>
            </ProfileInfoRow>
          )}
          {!selectedConnection && launchTarget && (
            <ProfileInfoRow label={t("Client API")}>
              <span className="truncate">
                {apiTypeProtocolDisplayLabel(launchTarget.apiType)}
              </span>
            </ProfileInfoRow>
          )}
          {modelEntries.length > 0 && (
            <ProfileInfoRow label={t("Model routes")}>
              <div className="space-y-1">
                {modelEntries.slice(0, 3).map((model, index) => (
                  <div
                    key={`${model.fakeModelId ?? ""}:${model.upstreamModel ?? ""}:${index}`}
                    className="flex min-w-0 items-center gap-1.5 font-mono text-[11px]"
                  >
                    <span className="min-w-0 truncate">
                      {model.fakeModelId || model.upstreamModel}
                    </span>
                    <span className="text-muted-foreground">-&gt;</span>
                    <span className="min-w-0 truncate">
                      {model.upstreamModel}
                    </span>
                  </div>
                ))}
                {modelEntries.length > 3 && (
                  <div className="text-[11px] text-muted-foreground">
                    {t("+{{count}} more", { count: modelEntries.length - 3 })}
                  </div>
                )}
              </div>
            </ProfileInfoRow>
          )}
        </>
      ) : (
        <>
          <ProfileInfoRow label={t("Launch mode")}>
            <span className="truncate">{t("Direct launch")}</span>
          </ProfileInfoRow>
          <ProfileInfoRow label={t("Route")}>
            <span className="truncate">{summary.route}</span>
          </ProfileInfoRow>
          <ProfileInfoRow label={t("API bridge")}>
            <span className="truncate">{t("Disabled")}</span>
          </ProfileInfoRow>
        </>
      )}
    </section>
  );
}

export function AgentLaunchBuilder({
  profiles,
  prefs,
  onPrefsChange,
  onProfilesChange,
  onNewProfile,
  onEditProfile,
  onConnectionSettings,
  onError,
  onToast,
}: Props) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [profileChoiceAgentId, setProfileChoiceAgentId] = useState<string>("");
  const [profileChoice, setProfileChoice] = useState<ProfileChoice>({
    kind: "direct",
  });
  const [openSelector, setOpenSelector] = useState<SelectorPopupId | null>(
    null,
  );
  const [workspaceOptions, setWorkspaceOptions] = useState<
    WorkspaceOption[] | null
  >(null);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [sessions, setSessions] = useState<LaunchSessionSummary[]>([]);
  const [workspaceSessionCounts, setWorkspaceSessionCounts] = useState<
    Record<string, number>
  >({});
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);
  const [sessionChoice, setSessionChoice] = useState<SessionChoice>(null);
  const [busy, setBusy] = useState(false);

  const enabledAgents = useMemo(
    () => (prefs ? new Set(prefs.enabledAgents) : null),
    [prefs?.enabledAgents],
  );
  const viewPrefs = useMemo<LauncherPreferences | null>(() => {
    if (!prefs) return null;
    return {
      ...prefs,
      workspace: agentWorkspace(prefs, agentId),
      workspaceOptions: workspaceOptions ?? prefs.workspaceOptions,
    };
  }, [prefs, workspaceOptions, agentId]);

  useEffect(() => {
    void listAgents()
      .then((items) => {
        const rank = new Map(AGENT_ORDER.map((id, index) => [id, index]));
        const visible = enabledAgents
          ? items.filter((agent) => enabledAgents.has(agent.id))
          : items;
        const ordered = [...visible].sort(
          (a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999),
        );
        setAgents(ordered);
      })
      .catch((error) =>
        onError(error instanceof Error ? error.message : String(error)),
      );
  }, [enabledAgents, onError]);

  useEffect(() => {
    if (!prefs) return;
    if (agentId && agents.some((agent) => agent.id === agentId)) return;
    const preferredAgent = agents.some(
      (agent) => agent.id === prefs.selectedAgent,
    )
      ? prefs.selectedAgent
      : agents.some((agent) => agent.id === prefs.defaultAgent)
        ? prefs.defaultAgent
      : (agents[0]?.id ?? "");
    setAgentId(preferredAgent);
  }, [agentId, agents, prefs]);

  useEffect(() => {
    if (!prefs || !agentId) return;
    setProfileChoice((current) => {
      if (profileChoiceAgentId === agentId) {
        if (current.kind === "direct") return current;
        if (
          profileSupportsAgent(
            profileById(profiles, current.profileId),
            agentId,
            prefs,
          )
        ) {
          return current;
        }
      }

      const defaultProfileId = agentProfileId(prefs, agentId);
      if (
        defaultProfileId &&
        profileSupportsAgent(
          profileById(profiles, defaultProfileId),
          agentId,
          prefs,
        )
      ) {
        return { kind: "profile", profileId: defaultProfileId };
      }
      return { kind: "direct" };
    });
    setProfileChoiceAgentId(agentId);
    if (profileChoiceAgentId !== agentId) {
      setSessionChoice(null);
    }
  }, [agentId, prefs, profileChoiceAgentId, profiles]);

  useEffect(() => {
    if (!prefs || !agentId) {
      setWorkspaceOptions(null);
      setWorkspacesLoading(false);
      return;
    }

    let cancelled = false;
    setWorkspacesLoading(true);
    void listLauncherWorkspaces(agentId)
      .then((items) => {
        if (!cancelled) setWorkspaceOptions(items);
      })
      .catch((error) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setWorkspacesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [prefs, agentId, onError]);

  const currentAgentWorkspace = prefs ? agentWorkspace(prefs, agentId) : "";

  useEffect(() => {
    if (!agentId || !currentAgentWorkspace) {
      setSessions([]);
      setSessionsLoading(false);
      return;
    }
    if (!agentSupportsSessionResume(agentId)) {
      setSessions([]);
      setSessionChoice(null);
      setSessionsLoading(false);
      return;
    }
    let cancelled = false;
    setSessionsLoading(true);
    void listLaunchSessions(agentId, currentAgentWorkspace, showArchivedSessions)
      .then((items) => {
        if (cancelled) return;
        setSessions(items);
        setSessionChoice((current) =>
          current?.kind === "session" &&
          items.some((item) => item.sessionId === current.sessionId)
            ? current
            : null,
        );
      })
      .catch((error) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, currentAgentWorkspace, showArchivedSessions, onError]);

  useEffect(() => {
    if (!agentId || !agentSupportsSessionResume(agentId) || !viewPrefs) {
      setWorkspaceSessionCounts({});
      return;
    }
    let cancelled = false;
    const workspaces = viewPrefs.workspaceOptions;
    void Promise.all(
      workspaces.map((workspace) =>
        listLaunchSessions(agentId, workspace.path, false)
          .then((items) => [workspace.path, items.length] as const)
          .catch(() => [workspace.path, 0] as const),
      ),
    ).then((entries) => {
      if (!cancelled) {
        setWorkspaceSessionCounts(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, viewPrefs?.workspaceOptions]);

  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const selectedProfile =
    profileChoice.kind === "profile"
      ? profileById(profiles, profileChoice.profileId)
      : null;
  const profileOptions = profiles;
  const visibleSessions = useMemo(
    () =>
      showArchivedSessions
        ? sessions
        : sessions.filter((session) => !session.archived),
    [sessions, showArchivedSessions],
  );
  const selectedWorkspace = currentWorkspace(viewPrefs);
  const selectedTerminal = currentTerminal(viewPrefs);
  const selectedSession = resolveSelectedSession(
    sessionChoice,
    visibleSessions,
  );
  const selectionLaunchable = viewPrefs
    ? isSelectionLaunchable(profileChoice, selectedProfile, agentId, viewPrefs)
    : false;
  const selectionDisabledReason = viewPrefs
    ? selectionUnavailableReason(
        profileChoice,
        selectedProfile,
        agentId,
        viewPrefs,
        t,
      )
    : t("Loading…");
  const sessionResumeSupported = agentSupportsSessionResume(agentId);
  const sessionResumeUnsupportedReason = t(
    "{{agent}} does not support selecting a session to resume",
    { agent: agentLabel(agentId) },
  );
  const launchDisabledReason = busy
    ? t("Launch is already in progress")
    : selectionDisabledReason;

  async function refreshPrefs() {
    onPrefsChange(await getLauncherPreferences());
  }

  async function refreshProfiles() {
    onProfilesChange(await listProfiles());
  }

  async function chooseAgent(nextAgentId: string) {
    setAgentId(nextAgentId);
    setSessionChoice(null);
    onError(null);
    try {
      await setLauncherSelectedAgent(nextAgentId);
      await refreshPrefs();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function chooseProfileChoice(choice: ProfileChoice) {
    setProfileChoice(choice);
    if (!agentId) return;
    onError(null);
    try {
      await setLauncherAgentProfile(
        agentId,
        choice.kind === "profile" ? choice.profileId : null,
      );
      await refreshPrefs();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function chooseProfileApiType(profile: ProfileSummary, apiType: string) {
    if (!viewPrefs || !isBridgeAgent(agentId)) return;
    const current = viewPrefs.profileConnections[profile.id]?.[agentId] ?? {};
    onError(null);
    try {
      await setProfileConnection(profile.id, agentId, {
        ...current,
        selectedApiType: apiType,
      });
      await refreshPrefs();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }

  async function chooseWorkspace(path: string) {
    if (!prefs || !agentId || path === agentWorkspace(prefs, agentId)) {
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await setLauncherWorkspace(path, agentId);
      await refreshPrefs();
      setSessionChoice(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function chooseTerminal(terminalId: string) {
    if (!viewPrefs || terminalId === viewPrefs.terminal) return;
    setBusy(true);
    onError(null);
    try {
      await setLauncherTerminal(terminalId);
      await refreshPrefs();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolder() {
    if (!agentId) return;
    setBusy(true);
    onError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("Choose Launch Workspace"),
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      await setLauncherWorkspace(path, agentId);
      await refreshPrefs();
      setSessionChoice(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(choice: ProfileChoice) {
    setBusy(true);
    onError(null);
    try {
      await setLauncherDefault(
        agentId,
        choice.kind === "profile" ? choice.profileId : null,
      );
      await refreshPrefs();
      onToast(t("VibeAround default updated"));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeWorkspace(path: string, label: string) {
    if (!window.confirm(t('Delete workspace "{{label}}"?', { label }))) return;
    setBusy(true);
    onError(null);
    try {
      await removeLauncherWorkspace(path);
      await refreshPrefs();
      setSessionChoice(null);
      onToast(t("Workspace removed"));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function reorderWorkspace(fromPath: string, toPath: string) {
    if (!viewPrefs || fromPath === toPath) return;
    const reorderablePaths = viewPrefs.workspaceOptions
      .filter(isSortableWorkspace)
      .map((workspace) => workspace.path);
    const nextPaths = moveItemBefore(reorderablePaths, fromPath, toPath);
    if (nextPaths === reorderablePaths) return;
    setBusy(true);
    onError(null);
    try {
      await reorderLauncherWorkspaces(nextPaths);
      await refreshPrefs();
      onToast(t("Workspace order updated"));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeProfile(profile: ProfileSummary) {
    if (
      !window.confirm(
        t('Delete profile "{{label}}"?', { label: profile.label }),
      )
    )
      return;
    setBusy(true);
    onError(null);
    try {
      await deleteProfile(profile.id);
      await Promise.all([refreshProfiles(), refreshPrefs()]);
      onToast(t("Profile deleted"));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function reorderProfile(fromId: string, toId: string) {
    if (fromId === toId) return;
    const visibleIds = profileOptions.map((profile) => profile.id);
    const movedVisibleIds = moveItemBefore(visibleIds, fromId, toId);
    if (movedVisibleIds === visibleIds) return;
    const nextIds = mergeOrderedSubset(
      profiles.map((profile) => profile.id),
      new Set(visibleIds),
      movedVisibleIds,
    );
    setBusy(true);
    onError(null);
    try {
      await reorderProfiles(nextIds);
      await refreshProfiles();
      onToast(t("Profile order updated"));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function launchSelected() {
    if (!agentId) return;
    setBusy(true);
    onError(null);
    try {
      if (selectedSession) {
        if (profileChoice.kind === "profile") {
          await launchProfileResume(
            profileChoice.profileId,
            agentId,
            selectedSession.sessionId,
          );
        } else {
          await launchDirectResume(agentId, selectedSession.sessionId);
        }
        onToast(t("Resume launch opened"));
      } else {
        if (profileChoice.kind === "profile") {
          await launchProfile(profileChoice.profileId, agentId);
        } else {
          await launchDirect(agentId);
        }
        onToast(t("Quick launch opened"));
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!viewPrefs || agents.length === 0 || !selectedAgent) {
    if (prefs?.enabledAgents.length === 0) {
      return (
        <p className="p-3 text-xs text-muted-foreground">
          {t("No launch agents enabled")}
        </p>
      );
    }
    return <p className="p-3 text-xs text-muted-foreground">{t("Loading…")}</p>;
  }

  const selectedProfileSummary = selectedProfile
    ? profileSummary(selectedProfile, agentId, viewPrefs, t)
    : {
        title: t("Direct"),
        detail: t("Use existing CLI login"),
        bridge: false,
        route: t("Native CLI login"),
      };
  const sessionTitle = selectedSession?.title ?? t("New session");

  return (
    <TooltipProvider>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[74px] shrink-0 border-r border-border bg-card/50 px-2 py-3">
          <div className="flex flex-col gap-2">
            {agents.map((agent) => (
              <AgentRailButton
                key={agent.id}
                agent={agent}
                active={agent.id === agentId}
                isDefault={viewPrefs.defaultAgent === agent.id}
                onClick={() => void chooseAgent(agent.id)}
              />
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="bg-card/20 p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_190px] items-stretch gap-2">
                <div className="overflow-visible rounded-xl border border-border bg-card p-3 shadow-sm">
                  <AgentSummaryHeader
                    agentId={agentId}
                    agentLabelText={selectedAgent.display_name}
                  >
                    <SelectorPopup
                      id="profile"
                      openSelector={openSelector}
                      onOpenChange={setOpenSelector}
                      widthClassName="w-[min(340px,calc(100vw-1rem))]"
                      widthPx={340}
                      trigger={
                        <button
                          type="button"
                          className={`mt-0.5 flex max-w-[520px] min-w-0 items-center gap-1 rounded-sm text-left text-[12px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            openSelector === "profile"
                              ? "text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          onClick={() =>
                            setOpenSelector(
                              openSelector === "profile" ? null : "profile",
                            )
                          }
                        >
                          <span className="shrink-0">{t("Profile")}</span>
                          <span className="min-w-0 truncate font-semibold text-foreground">
                            {selectedProfileSummary.title}
                          </span>
                          <span className="min-w-0 truncate text-muted-foreground">
                            <span className="px-0.5">·</span>
                            {selectedProfileSummary.route}
                          </span>
                        </button>
                      }
                    >
                      <ProfileInfoPanel
                        agentId={agentId}
                        prefs={viewPrefs}
                        profile={selectedProfile}
                        summary={selectedProfileSummary}
                      />
                    </SelectorPopup>
                  </AgentSummaryHeader>
                  <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                    <Select
                      value={viewPrefs.terminal}
                      disabled={busy}
                      onValueChange={(terminalId) =>
                        void chooseTerminal(terminalId)
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        className="!h-9 w-[160px] justify-start gap-1.5 border-border/70 bg-transparent px-2.5 text-xs shadow-none hover:border-primary/35 [&>svg:last-child]:ml-auto"
                      >
                        <Terminal className="h-4 w-4 text-muted-foreground" />
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {t("Terminal")}
                        </span>
                        <SelectValue
                          className="min-w-0 truncate font-semibold text-foreground"
                          placeholder={selectedTerminal?.label ?? t("Terminal")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {viewPrefs.options.map((option) => (
                          <SelectItem
                            key={option.id}
                            value={option.id}
                            disabled={!option.installed}
                            className="text-xs"
                          >
                            {option.installed
                              ? option.label
                              : t("{{label}} (not installed)", {
                                  label: option.label,
                                })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <SelectorPopup
                      id="workspace"
                      openSelector={openSelector}
                      onOpenChange={setOpenSelector}
                      widthClassName="w-[min(400px,calc(100vw-1rem))]"
                      widthPx={400}
                      trigger={
                        <LaunchSummaryPill
                          active={openSelector === "workspace"}
                          chevron
                          className="w-[250px]"
                          icon={<FolderOpen className="h-4 w-4" />}
                          onClick={() =>
                            setOpenSelector(
                              openSelector === "workspace" ? null : "workspace",
                            )
                          }
                          label={t("Workspace")}
                          title={selectedWorkspace.label}
                          detail={
                            workspacesLoading
                              ? t("Loading…")
                              : t("{{count}} sessions", {
                                  count: visibleSessions.length,
                                })
                          }
                        />
                      }
                    >
                      <WorkspacePanel
                        prefs={viewPrefs}
                        loading={workspacesLoading}
                        onSelect={(path) => {
                          setOpenSelector(null);
                          void chooseWorkspace(path);
                        }}
                        onDelete={(path, label) =>
                          void removeWorkspace(path, label)
                        }
                        onReorder={(fromPath, toPath) =>
                          void reorderWorkspace(fromPath, toPath)
                        }
                        onCreate={() => {
                          setOpenSelector(null);
                          void chooseFolder();
                        }}
                        sessionCounts={workspaceSessionCounts}
                        busy={busy}
                      />
                    </SelectorPopup>
                    <SelectorPopup
                      id="session"
                      openSelector={openSelector}
                      onOpenChange={setOpenSelector}
                      align="end"
                      widthClassName="w-[min(420px,calc(100vw-1rem))]"
                      widthPx={420}
                      trigger={
                        <LaunchSummaryPill
                          active={openSelector === "session"}
                          chevron
                          disabled={!sessionResumeSupported}
                          className="w-[210px]"
                          icon={<MessageCircle className="h-4 w-4" />}
                          onClick={() =>
                            setOpenSelector(
                              openSelector === "session" ? null : "session",
                            )
                          }
                          label={t("Session")}
                          title={
                            !sessionResumeSupported
                              ? t("Session resume unavailable")
                              : sessionsLoading
                                ? t("Loading…")
                                : sessionTitle
                          }
                          detail={selectedSession ? t("resume") : undefined}
                        />
                      }
                    >
                      <SessionPanel
                        sessions={visibleSessions}
                        selected={sessionChoice}
                        archiveFilterAvailable={agentId === "codex"}
                        resumeSupported={sessionResumeSupported}
                        unsupportedReason={sessionResumeUnsupportedReason}
                        showArchived={showArchivedSessions}
                        onShowArchivedChange={setShowArchivedSessions}
                        onSelect={(choice) => {
                          setOpenSelector(null);
                          setSessionChoice(choice);
                        }}
                      />
                    </SelectorPopup>
                  </div>
                </div>
                <div className="flex">
                  <TooltipButton
                    type="button"
                    disabled={busy || !selectionLaunchable}
                    disabledReason={launchDisabledReason}
                    onClick={() => void launchSelected()}
                    size="lg"
                    className="h-full min-h-[115px] w-full rounded-xl justify-center text-base font-semibold tracking-[0.12em] shadow-md shadow-primary/15"
                  >
                    <Rocket className="h-5 w-5" />
                    {t("LAUNCH")}
                  </TooltipButton>
                </div>
              </div>
            </header>

            <section className="min-h-0 flex-1 overflow-y-auto p-2">
              <ProfilePanel
                agentId={agentId}
                prefs={viewPrefs}
                selected={profileChoice}
                profiles={profileOptions}
                onSelect={(choice) => void chooseProfileChoice(choice)}
                onSelectApiType={(profile, apiType) =>
                  void chooseProfileApiType(profile, apiType)
                }
                onMakeDefault={makeDefault}
                onEditProfile={onEditProfile}
                onConnectionSettings={onConnectionSettings}
                onDeleteProfile={(profile) => void removeProfile(profile)}
                onReorderProfile={(fromId, toId) =>
                  void reorderProfile(fromId, toId)
                }
                onNewProfile={onNewProfile}
                busy={busy}
              />
            </section>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
