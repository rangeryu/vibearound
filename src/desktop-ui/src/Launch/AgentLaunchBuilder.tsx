import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen,
  History,
  MessageCircle,
  Plus,
  Rocket,
  Terminal,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
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
  DefaultBadge,
  BridgeBadge,
  SelectorTile,
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
  agentProfileId,
  agentSupportsSessionResume,
  agentWorkspace,
  currentTerminal,
  currentWorkspace,
  isGlobalDefaultDirect,
  isGlobalDefaultProfile,
  isBridgeAgent,
  isSelectionLaunchable,
  isSortableWorkspace,
  mergeOrderedSubset,
  moveItemBefore,
  profileById,
  profileSupportsAgent,
  profileSummary,
  relativeTime,
  resolveSelectedSession,
  selectionUnavailableReason,
  type ProfileChoice,
  type SessionChoice,
} from "./launchModel";
import type { ConnectionAgentId, ProfileSummary } from "./types";

type SelectorPopupId = "workspace" | "session";

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
  trigger,
  children,
}: {
  id: SelectorPopupId;
  openSelector: SelectorPopupId | null;
  onOpenChange: (id: SelectorPopupId | null) => void;
  align?: "start" | "end";
  widthClassName: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const open = openSelector === id;

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

  return (
    <div ref={ref} className="relative min-w-0">
      {trigger}
      {open && (
        <div
          className={`absolute top-full z-50 mt-2 ${align === "end" ? "right-0" : "left-0"} ${widthClassName}`}
        >
          <div className="max-h-[min(64vh,480px)] overflow-y-auto">
            {children}
          </div>
        </div>
      )}
    </div>
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
  const canResume = sessionResumeSupported && Boolean(selectedSession);
  const resumeDisabledReason = busy
    ? t("Launch is already in progress")
    : !sessionResumeSupported
      ? sessionResumeUnsupportedReason
      : !selectedSession
        ? t("No session to resume")
        : selectionDisabledReason;
  const quickLaunchDisabledReason = busy
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

  async function launchNew() {
    if (!agentId) return;
    setBusy(true);
    onError(null);
    try {
      if (profileChoice.kind === "profile") {
        await launchProfile(profileChoice.profileId, agentId);
      } else {
        await launchDirect(agentId);
      }
      onToast(t("Quick launch opened"));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function launchResume() {
    if (!agentId || !selectedSession) return;
    setBusy(true);
    onError(null);
    try {
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
  const profileIsGlobalDefault =
    profileChoice.kind === "profile"
      ? isGlobalDefaultProfile(viewPrefs, agentId, profileChoice.profileId)
      : isGlobalDefaultDirect(viewPrefs, agentId);
  const sessionTitle = selectedSession?.title ?? t("No session to resume");
  const sessionDetail = selectedSession
    ? `${selectedSession.shortId} · ${relativeTime(selectedSession.updatedAt, t)}`
    : sessionResumeSupported
      ? t("Quick Launch will start a new session")
      : sessionResumeUnsupportedReason;

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
            <header className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-stretch gap-2 border-b border-border bg-card/20 p-2">
              <SelectorTile
                active
                icon={
                  selectedProfile ? (
                    <BrandIcon
                      kind="provider"
                      id={selectedProfile.provider}
                      label={selectedProfile.providerLabel}
                      fallback={selectedProfile.providerIcon}
                      framed={false}
                      className="h-8 w-8"
                    />
                  ) : (
                    <Terminal className="h-4 w-4" />
                  )
                }
                label={t("Profile")}
                title={selectedProfileSummary.title}
                detail={selectedProfileSummary.route}
                badges={
                  <>
                    {selectedProfileSummary.bridge && <BridgeBadge />}
                    {profileIsGlobalDefault && <DefaultBadge />}
                  </>
                }
              />
              <SelectorPopup
                id="workspace"
                openSelector={openSelector}
                onOpenChange={setOpenSelector}
                widthClassName="w-[min(400px,calc(100vw-1rem))]"
                trigger={
                  <SelectorTile
                    active={openSelector === "workspace"}
                    onClick={() =>
                      setOpenSelector(
                        openSelector === "workspace" ? null : "workspace",
                      )
                    }
                    icon={<FolderOpen className="h-4 w-4" />}
                    label={t("Workspace")}
                    title={selectedWorkspace.label}
                    detail={
                      workspacesLoading
                        ? t("Loading…")
                        : t("{{count}} sessions", {
                            count: visibleSessions.length,
                          })
                    }
                    badges={
                      selectedWorkspace.isDefault ? <DefaultBadge /> : null
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
                  onDelete={(path, label) => void removeWorkspace(path, label)}
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
                trigger={
                  <SelectorTile
                    active={openSelector === "session"}
                    onClick={() =>
                      setOpenSelector(
                        openSelector === "session" ? null : "session",
                      )
                    }
                    icon={<MessageCircle className="h-4 w-4" />}
                    label={t("Session")}
                    title={
                      !sessionResumeSupported
                        ? t("Session resume unavailable")
                        : sessionsLoading
                          ? t("Loading…")
                          : sessionTitle
                    }
                    detail={sessionDetail}
                    disabled={!sessionResumeSupported}
                    disabledReason={sessionResumeUnsupportedReason}
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-full min-h-[62px] justify-center px-3 text-xs"
                onClick={onNewProfile}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("New profile")}
              </Button>
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
                busy={busy}
              />
            </section>

            <footer className="flex items-center justify-end gap-2 border-t border-border bg-card/30 px-4 py-3">
              <Select
                value={viewPrefs.terminal}
                disabled={busy}
                onValueChange={(terminalId) => void chooseTerminal(terminalId)}
              >
                <SelectTrigger size="sm" className="!h-10 w-[120px] px-3 text-xs">
                  <Terminal className="h-3.5 w-3.5" />
                  <SelectValue placeholder={selectedTerminal?.label ?? t("Terminal")} />
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
                        : t("{{label}} (not installed)", { label: option.label })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <TooltipButton
                type="button"
                disabled={busy || !canResume || !selectionLaunchable}
                disabledReason={resumeDisabledReason}
                onClick={() => void launchResume()}
                size="lg"
                variant="outline"
                className="min-w-[160px] justify-center text-xs font-semibold"
              >
                <History className="h-3.5 w-3.5" />
                {t("Resume Session")}
              </TooltipButton>
              <TooltipButton
                type="button"
                disabled={busy || !selectionLaunchable}
                disabledReason={quickLaunchDisabledReason}
                onClick={() => void launchNew()}
                size="lg"
                className="min-w-[160px] justify-center text-xs font-semibold"
              >
                <Rocket className="h-3.5 w-3.5" />
                {t("Quick Launch")}
              </TooltipButton>
            </footer>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
