import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  FolderOpen,
  FolderPlus,
  GripVertical,
  History,
  MessageCircle,
  MoreVertical,
  Pencil,
  Plug,
  Plus,
  Rocket,
  Star,
  Terminal,
  Trash2,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  apiTypeRouteLabel,
  resolveProfileConnection,
  type ConnectionAgentDef,
} from "./connections";
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
  setLauncherDefault,
  setLauncherWorkspace,
  type AgentSummary,
  type LaunchSessionSummary,
  type LauncherPreferences,
  type WorkspaceOption,
} from "./api";
import type { ConnectionAgentId, ProfileSummary } from "./types";

const AGENT_ORDER = [
  "codex",
  "claude",
  "gemini",
  "cursor",
  "kiro",
  "qwen-code",
  "opencode",
];
const PROXY_AGENTS = new Set<string>(["claude", "codex"]);
const SESSION_RESUME_AGENTS = new Set<string>([
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "qwen-code",
]);

type ExpandedBlock = "profile" | "workspace" | "session";
type ProfileChoice =
  | { kind: "direct" }
  | { kind: "profile"; profileId: string };
type SessionChoice = { kind: "session"; sessionId: string } | null;

interface Props {
  profiles: ProfileSummary[];
  prefs: LauncherPreferences | null;
  onPrefsChange: (prefs: LauncherPreferences) => void;
  onProfilesChange: (profiles: ProfileSummary[]) => void;
  onNewProfile: () => void;
  onEditProfile: (profile: ProfileSummary) => void;
  onConnectionSettings: (profile: ProfileSummary) => void;
  onError: (message: string | null) => void;
  onToast: (message: string | null) => void;
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
  const [expanded, setExpanded] = useState<ExpandedBlock>("profile");
  const [workspaceOptions, setWorkspaceOptions] = useState<
    WorkspaceOption[] | null
  >(null);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [sessions, setSessions] = useState<LaunchSessionSummary[]>([]);
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
      workspaceOptions: workspaceOptions ?? prefs.workspaceOptions,
    };
  }, [prefs, workspaceOptions]);

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
      (agent) => agent.id === prefs.defaultAgent,
    )
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

      const defaultProfileId = prefs.defaultProfiles[agentId];
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
    if (!prefs) {
      setWorkspaceOptions(null);
      setWorkspacesLoading(false);
      return;
    }

    let cancelled = false;
    setWorkspacesLoading(true);
    void listLauncherWorkspaces()
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
  }, [prefs, onError]);

  useEffect(() => {
    if (!agentId || !prefs?.workspace) {
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
    void listLaunchSessions(agentId, prefs.workspace, showArchivedSessions)
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
  }, [agentId, prefs?.workspace, showArchivedSessions, onError]);

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

  async function chooseWorkspace(path: string) {
    if (!prefs || path === prefs.workspace) {
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await setLauncherWorkspace(path);
      await refreshPrefs();
      setSessionChoice(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function chooseFolder() {
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
      await setLauncherWorkspace(path);
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
      onToast(t("Quick Launch default updated"));
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
    ? profileSummary(selectedProfile, agentId, viewPrefs)
    : {
        title: t("Direct"),
        detail: t("Use existing CLI login"),
        proxy: false,
        route: t("Native CLI login"),
      };
  const profileIsDefault =
    profileChoice.kind === "profile"
      ? viewPrefs.defaultProfiles[agentId] === profileChoice.profileId
      : !viewPrefs.defaultProfiles[agentId] &&
        viewPrefs.defaultAgent === agentId;
  const sessionTitle = selectedSession?.title ?? t("No session to resume");
  const sessionDetail = selectedSession
    ? `${selectedSession.shortId} · ${relativeTime(selectedSession.updatedAt)}`
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
                isDefault={
                  viewPrefs.defaultAgent === agent.id ||
                  Boolean(viewPrefs.defaultProfiles[agent.id])
                }
                onClick={() => {
                  setAgentId(agent.id);
                  setExpanded("profile");
                }}
              />
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BrandIcon
                  kind="cli"
                  id={agentId}
                  label={selectedAgent.display_name}
                  className="h-7 w-7"
                />
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold">
                    {selectedAgent.display_name}
                  </h2>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={onNewProfile}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("New profile")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={busy}
                onClick={() => void chooseFolder()}
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {t("New workspace")}
              </Button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid grid-cols-3 gap-2 border-b border-border bg-card/20 p-3">
              <SelectorTile
                active={expanded === "profile"}
                onClick={() => setExpanded("profile")}
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
                    {selectedProfileSummary.proxy && <ProxyBadge />}
                    {profileIsDefault && <DefaultBadge />}
                  </>
                }
              />
              <SelectorTile
                active={expanded === "workspace"}
                onClick={() => setExpanded("workspace")}
                icon={<FolderOpen className="h-4 w-4" />}
                label={t("Workspace")}
                title={selectedWorkspace.label}
                detail={
                  workspacesLoading
                    ? t("Loading…")
                    : t("{{count}} sessions", { count: visibleSessions.length })
                }
                badges={selectedWorkspace.isDefault ? <DefaultBadge /> : null}
              />
              <SelectorTile
                active={expanded === "session"}
                onClick={() => setExpanded("session")}
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
            </div>

            <section className="min-h-0 flex-1 overflow-y-auto p-3">
              {expanded === "profile" && (
                <ProfilePanel
                  agentId={agentId}
                  prefs={viewPrefs}
                  selected={profileChoice}
                  profiles={profileOptions}
                  onSelect={setProfileChoice}
                  onMakeDefault={makeDefault}
                  onEditProfile={onEditProfile}
                  onConnectionSettings={onConnectionSettings}
                  onDeleteProfile={(profile) => void removeProfile(profile)}
                  onReorderProfile={(fromId, toId) =>
                    void reorderProfile(fromId, toId)
                  }
                  busy={busy}
                />
              )}
              {expanded === "workspace" && (
                <WorkspacePanel
                  prefs={viewPrefs}
                  loading={workspacesLoading}
                  onSelect={(path) => void chooseWorkspace(path)}
                  onDelete={(path, label) => void removeWorkspace(path, label)}
                  onReorder={(fromPath, toPath) =>
                    void reorderWorkspace(fromPath, toPath)
                  }
                  busy={busy}
                />
              )}
              {expanded === "session" && (
                <SessionPanel
                  sessions={visibleSessions}
                  selected={sessionChoice}
                  archiveFilterAvailable={agentId === "codex"}
                  resumeSupported={sessionResumeSupported}
                  unsupportedReason={sessionResumeUnsupportedReason}
                  showArchived={showArchivedSessions}
                  onShowArchivedChange={setShowArchivedSessions}
                  onSelect={setSessionChoice}
                />
              )}
            </section>

            <footer className="flex justify-end gap-2 border-t border-border bg-card/30 px-4 py-3">
              <TooltipButton
                type="button"
                disabled={busy || !canResume || !selectionLaunchable}
                disabledReason={resumeDisabledReason}
                onClick={() => void launchResume()}
                className="h-10 min-w-[160px] justify-center text-xs font-semibold"
              >
                <Rocket className="h-3.5 w-3.5" />
                {t("Resume Session")}
              </TooltipButton>
              <TooltipButton
                type="button"
                disabled={busy || !selectionLaunchable}
                disabledReason={quickLaunchDisabledReason}
                onClick={() => void launchNew()}
                variant="outline"
                className="h-10 min-w-[160px] justify-center text-xs font-semibold"
              >
                <Terminal className="h-3.5 w-3.5" />
                {t("Quick Launch")}
              </TooltipButton>
            </footer>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

function SelectorTile({
  active,
  onClick,
  icon,
  label,
  title,
  detail,
  badges,
  disabled = false,
  disabledReason,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title: string;
  detail: string;
  badges?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const tile = (
    <button
      type="button"
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      title={disabled ? disabledReason : undefined}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={`flex min-h-[76px] items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
        disabled
          ? "cursor-not-allowed border-border bg-card text-muted-foreground opacity-60"
          : active
            ? "border-primary bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]"
            : "border-border bg-card hover:border-primary/40"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${
          active
            ? "border-primary/40 bg-background text-primary"
            : "border-border/70 bg-background text-muted-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`text-[11px] font-semibold uppercase ${active ? "text-primary" : "text-muted-foreground"}`}
          >
            {label}
          </span>
          {badges}
        </span>
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {detail}
        </span>
      </span>
    </button>
  );
  if (!disabled || !disabledReason) return tile;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

function ProfilePanel({
  agentId,
  prefs,
  selected,
  profiles,
  onSelect,
  onMakeDefault,
  onEditProfile,
  onConnectionSettings,
  onDeleteProfile,
  onReorderProfile,
  busy,
}: {
  agentId: string;
  prefs: LauncherPreferences;
  selected: ProfileChoice;
  profiles: ProfileSummary[];
  onSelect: (choice: ProfileChoice) => void;
  onMakeDefault: (choice: ProfileChoice) => Promise<void>;
  onEditProfile: (profile: ProfileSummary) => void;
  onConnectionSettings: (profile: ProfileSummary) => void;
  onDeleteProfile: (profile: ProfileSummary) => void;
  onReorderProfile: (fromId: string, toId: string) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const directIsDefault =
    !prefs.defaultProfiles[agentId] && prefs.defaultAgent === agentId;
  const directActive = selected.kind === "direct";

  function handleProfileDragEnd(event: DragEndEvent) {
    if (event.canceled || busy) return;
    const { source } = event.operation;
    if (!isSortable(source) || source.initialIndex === source.index) return;
    const from = profiles[source.initialIndex]?.id;
    const to = profiles[source.index]?.id;
    if (from && to) onReorderProfile(from, to);
  }

  return (
    <section className="space-y-2">
      <SelectableItemCard
        active={directActive}
        onSelect={() => onSelect({ kind: "direct" })}
      >
        <DragHandle
          disabled
          label={t("Direct")}
          disabledReason={t("Direct profile is fixed")}
        />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
          <Terminal className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-semibold">
              {t("Direct")}
            </span>
            {directIsDefault && <DefaultBadge />}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {t("Use existing CLI login")}
          </div>
        </div>
        <div
          className="flex shrink-0 flex-wrap justify-end gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          {!directIsDefault && (
            <TooltipButton
              type="button"
              size="xs"
              variant="ghost"
              className="h-7 text-[11px]"
              disabled={busy}
              disabledReason={t("Launch is already in progress")}
              onClick={() => void onMakeDefault({ kind: "direct" })}
            >
              <Star className="h-3 w-3" />
              {t("Set default")}
            </TooltipButton>
          )}
          <DisabledMoreButton
            reason={t("Direct profile cannot be edited or deleted")}
          />
        </div>
      </SelectableItemCard>

      <DragDropProvider onDragEnd={handleProfileDragEnd}>
        {profiles.map((profile, index) => {
          const availability = profileAvailability(profile, agentId, prefs, t);
          return (
            <SortableItem
              key={profile.id}
              id={profile.id}
              index={index}
              disabled={busy || !availability.launchable}
            >
              {({ dragHandleRef, isDragging }) => {
                const summary = profileSummary(profile, agentId, prefs);
                const active =
                  availability.launchable &&
                  selected.kind === "profile" &&
                  selected.profileId === profile.id;
                const defaultForAgent =
                  prefs.defaultProfiles[agentId] === profile.id;
                return (
                  <SelectableItemCard
                    active={active}
                    disabled={!availability.launchable}
                    disabledReason={availability.reason}
                    isDragging={isDragging}
                    onSelect={() =>
                      onSelect({ kind: "profile", profileId: profile.id })
                    }
                  >
                    <DragHandle
                      label={t("Reorder {{label}}", { label: profile.label })}
                      disabled={busy || !availability.launchable}
                      disabledReason={
                        busy
                          ? t("Reordering unavailable while launching")
                          : availability.reason
                      }
                      dragHandleRef={dragHandleRef}
                    />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background">
                      <BrandIcon
                        kind="provider"
                        id={profile.provider}
                        label={profile.providerLabel}
                        fallback={profile.providerIcon}
                        framed={false}
                        className="h-7 w-7"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-[13px] font-semibold">
                          {profile.label}
                        </span>
                        {defaultForAgent && <DefaultBadge />}
                        {summary.proxy && <ProxyBadge />}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {availability.launchable
                          ? summary.route
                          : availability.reason}
                      </div>
                    </div>
                    <div
                      className="flex shrink-0 flex-wrap items-center justify-end gap-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {!defaultForAgent && (
                        <TooltipButton
                          type="button"
                          size="xs"
                          variant="ghost"
                          className="h-7 text-[11px]"
                          disabled={busy || !availability.launchable}
                          disabledReason={
                            busy
                              ? t("Launch is already in progress")
                              : availability.reason
                          }
                          onClick={() =>
                            void onMakeDefault({
                              kind: "profile",
                              profileId: profile.id,
                            })
                          }
                        >
                          <Star className="h-3 w-3" />
                          {t("Set default")}
                        </TooltipButton>
                      )}
                      <ProfileActionsMenu
                        profile={profile}
                        onConnectionSettings={onConnectionSettings}
                        onEditProfile={onEditProfile}
                        onDeleteProfile={onDeleteProfile}
                      />
                    </div>
                  </SelectableItemCard>
                );
              }}
            </SortableItem>
          );
        })}
      </DragDropProvider>
    </section>
  );
}

function WorkspacePanel({
  prefs,
  loading,
  onSelect,
  onDelete,
  onReorder,
  busy,
}: {
  prefs: LauncherPreferences;
  loading: boolean;
  onSelect: (path: string) => void;
  onDelete: (path: string, label: string) => void;
  onReorder: (fromPath: string, toPath: string) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const workspaceOptions = [...prefs.workspaceOptions].sort((a, b) => {
    if (a.isDefault === b.isDefault) return 0;
    return a.isDefault ? -1 : 1;
  });
  const sortableWorkspaces = workspaceOptions.filter(isSortableWorkspace);

  function handleWorkspaceDragEnd(event: DragEndEvent) {
    if (event.canceled || busy) return;
    const { source } = event.operation;
    if (!isSortable(source) || source.initialIndex === source.index) return;
    const from = sortableWorkspaces[source.initialIndex]?.path;
    const to = sortableWorkspaces[source.index]?.path;
    if (from && to) onReorder(from, to);
  }

  function renderWorkspaceRow(
    workspace: WorkspaceOption,
    dragHandleRef?: Ref<HTMLSpanElement>,
    isDragging = false,
  ) {
    const active = workspace.path === prefs.workspace;
    const sortable = isSortableWorkspace(workspace);
    const canDelete = canDeleteWorkspace(workspace);
    return (
      <SelectableItemCard
        key={workspace.path}
        active={active}
        disabled={busy}
        isDragging={isDragging}
        onSelect={() => onSelect(workspace.path)}
      >
        <DragHandle
          disabled={!sortable || busy}
          label={t("Reorder {{label}}", { label: workspace.label })}
          disabledReason={
            !sortable
              ? workspace.isDefault
                ? t("Default workspace is fixed")
                : t("This item cannot be reordered")
              : t("Reordering unavailable while launching")
          }
          dragHandleRef={dragHandleRef}
        />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
          <FolderOpen className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-semibold">
              {workspace.label}
            </span>
            {workspace.isDefault && <DefaultBadge />}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {workspace.detail}
          </span>
        </span>
        <span
          className="flex shrink-0 flex-wrap items-center justify-end gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          {canDelete ? (
            <WorkspaceActionsMenu
              workspace={workspace}
              onDelete={(target) => onDelete(target.path, target.label)}
            />
          ) : (
            <DisabledMoreButton
              reason={
                workspace.isDefault
                  ? t("Default workspace cannot be edited or deleted")
                  : t("No actions available")
              }
            />
          )}
        </span>
      </SelectableItemCard>
    );
  }

  return (
    <section className="space-y-2">
      {loading && workspaceOptions.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {t("Loading…")}
        </p>
      )}
      <DragDropProvider onDragEnd={handleWorkspaceDragEnd}>
        {workspaceOptions.map((workspace) => {
          if (!isSortableWorkspace(workspace)) {
            return renderWorkspaceRow(workspace);
          }
          const index = sortableWorkspaces.findIndex(
            (sortable) => sortable.path === workspace.path,
          );
          return (
            <SortableItem
              key={workspace.path}
              id={workspace.path}
              index={index}
              disabled={busy}
            >
              {({ dragHandleRef, isDragging }) =>
                renderWorkspaceRow(workspace, dragHandleRef, isDragging)
              }
            </SortableItem>
          );
        })}
      </DragDropProvider>
    </section>
  );
}

function SessionPanel({
  sessions,
  selected,
  archiveFilterAvailable,
  resumeSupported,
  unsupportedReason,
  showArchived,
  onShowArchivedChange,
  onSelect,
}: {
  sessions: LaunchSessionSummary[];
  selected: SessionChoice;
  archiveFilterAvailable: boolean;
  resumeSupported: boolean;
  unsupportedReason: string;
  showArchived: boolean;
  onShowArchivedChange: (show: boolean) => void;
  onSelect: (choice: SessionChoice) => void;
}) {
  const { t } = useI18n();
  if (!resumeSupported) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        {unsupportedReason}
      </p>
    );
  }
  return (
    <section className="space-y-2">
      {archiveFilterAvailable && (
        <div className="flex items-center justify-end gap-2 px-1 text-[11px] text-muted-foreground">
          <Archive className="h-3.5 w-3.5" />
          <span>{t("Show archived")}</span>
          <Switch
            checked={showArchived}
            onCheckedChange={onShowArchivedChange}
            aria-label={t("Show archived")}
          />
        </div>
      )}
      {sessions.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {t("No session in this workspace")}
        </p>
      )}
      {sessions.map((session) => {
        const active =
          selected?.kind === "session" &&
          selected.sessionId === session.sessionId;
        const isLast = session === sessions[0];
        return (
          <SelectableItemCard
            key={`${session.sessionId}:${session.archived ? "archived" : "active"}`}
            active={active}
            onSelect={() =>
              onSelect({ kind: "session", sessionId: session.sessionId })
            }
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
              <MessageCircle className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13px] font-semibold">
                  {session.title}
                </span>
                {session.archived && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                    <Archive className="h-3 w-3" />
                    {t("Archived")}
                  </span>
                )}
                {isLast && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    <History className="h-3 w-3" />
                    {t("Last session")}
                  </span>
                )}
              </span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                {session.shortId} · {relativeTime(session.updatedAt)}
              </span>
            </span>
          </SelectableItemCard>
        );
      })}
    </section>
  );
}

function SelectableItemCard({
  active,
  disabled = false,
  disabledReason,
  isDragging = false,
  children,
  onSelect,
}: {
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  isDragging?: boolean;
  children: ReactNode;
  onSelect: () => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onSelect();
  }

  const card = (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      onKeyDown={handleKeyDown}
      className={`flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary shadow-[inset_3px_0_0_hsl(var(--primary))]"
          : "border-border bg-card hover:border-primary/40 hover:bg-accent/35"
      } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${
        isDragging ? "opacity-55" : ""
      }`}
    >
      {children}
    </div>
  );
  if (!disabled || !disabledReason) return card;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

function SortableItem({
  id,
  index,
  disabled,
  children,
}: {
  id: string;
  index: number;
  disabled: boolean;
  children: (props: {
    dragHandleRef: Ref<HTMLSpanElement>;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id,
    index,
    disabled,
  });

  return (
    <div
      ref={ref}
      className={`relative rounded-md transition-shadow ${
        isDropTarget ? "ring-2 ring-primary/35 shadow-lg shadow-primary/20" : ""
      }`}
    >
      {children({
        dragHandleRef: handleRef as Ref<HTMLSpanElement>,
        isDragging,
      })}
    </div>
  );
}

function DragHandle({
  label,
  disabled = false,
  disabledReason,
  dragHandleRef,
}: {
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  dragHandleRef?: Ref<HTMLSpanElement>;
}) {
  const { t } = useI18n();
  const tooltip = disabled
    ? (disabledReason ?? t("This item cannot be reordered"))
    : label;
  const handle = (
    <span
      ref={disabled ? undefined : dragHandleRef}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-disabled={disabled}
      title={tooltip}
      onClick={(event) => event.stopPropagation()}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground ${
        disabled
          ? "cursor-not-allowed opacity-35"
          : "cursor-grab hover:bg-muted hover:text-foreground active:cursor-grabbing"
      }`}
    >
      <GripVertical className="h-4 w-4" />
    </span>
  );

  if (!disabled) return handle;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{handle}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function DisabledMoreButton({ reason }: { reason?: string }) {
  const { t } = useI18n();
  const tooltip = reason ?? t("No actions available");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex cursor-not-allowed"
          tabIndex={0}
          role="button"
          aria-disabled="true"
          aria-label={tooltip}
          title={tooltip}
        >
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground"
            disabled
            aria-label={tooltip}
            title={tooltip}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function TooltipButton({
  disabledReason,
  disabled,
  children,
  ...props
}: ComponentProps<typeof Button> & { disabledReason?: string }) {
  const button = (
    <Button {...props} disabled={disabled}>
      {children}
    </Button>
  );
  if (!disabled || !disabledReason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex"
          tabIndex={0}
          aria-disabled="true"
          title={disabledReason}
        >
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

function ProfileActionsMenu({
  profile,
  onConnectionSettings,
  onEditProfile,
  onDeleteProfile,
}: {
  profile: ProfileSummary;
  onConnectionSettings: (profile: ProfileSummary) => void;
  onEditProfile: (profile: ProfileSummary) => void;
  onDeleteProfile: (profile: ProfileSummary) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground"
          aria-label={t("More")}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem
          className="text-xs"
          onSelect={() => onConnectionSettings(profile)}
        >
          <Plug className="h-3 w-3" />
          {t("Proxy")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-xs"
          onSelect={() => onEditProfile(profile)}
        >
          <Pencil className="h-3 w-3" />
          {t("Edit")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-xs"
          variant="destructive"
          onSelect={() => onDeleteProfile(profile)}
        >
          <Trash2 className="h-3 w-3" />
          {t("Delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceActionsMenu({
  workspace,
  onDelete,
}: {
  workspace: WorkspaceOption;
  onDelete: (workspace: WorkspaceOption) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground"
          aria-label={t("More")}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem
          className="text-xs"
          variant="destructive"
          onSelect={() => onDelete(workspace)}
        >
          <Trash2 className="h-3 w-3" />
          {t("Delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DefaultBadge() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
      <Star className="h-3 w-3" />
      {t("Default")}
    </span>
  );
}

function ProxyBadge() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
      <Plug className="h-3 w-3" />
      {t("Proxy on")}
    </span>
  );
}

function AgentRailButton({
  agent,
  active,
  isDefault,
  onClick,
}: {
  agent: AgentSummary;
  active: boolean;
  isDefault: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={agent.display_name}
      className={`relative flex h-14 w-14 items-center justify-center rounded-md border transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      <BrandIcon
        kind="cli"
        id={agent.id}
        label={agent.display_name}
        framed={false}
        className="h-9 w-9"
      />
      {isDefault && (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-amber-500/40 bg-background text-amber-600 shadow-sm dark:text-amber-300">
          <Star className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}

function moveItemBefore(items: string[], from: string, to: string): string[] {
  if (from === to) return items;
  const fromIndex = items.indexOf(from);
  const toIndex = items.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function mergeOrderedSubset(
  allIds: string[],
  subsetIds: Set<string>,
  orderedSubsetIds: string[],
): string[] {
  const queue = [...orderedSubsetIds];
  return allIds.map((id) => (subsetIds.has(id) ? (queue.shift() ?? id) : id));
}

function isSortableWorkspace(workspace: WorkspaceOption): boolean {
  return workspace.kind === "workspace" && !workspace.isDefault;
}

function canDeleteWorkspace(workspace: WorkspaceOption): boolean {
  return workspace.kind === "workspace" && !workspace.isDefault;
}

function currentWorkspace(prefs: LauncherPreferences | null): WorkspaceOption {
  if (!prefs) {
    return {
      path: "",
      label: "Workspace",
      detail: "",
      kind: "selected",
      isDefault: false,
    };
  }
  return (
    prefs.workspaceOptions.find(
      (option) => option.path === prefs.workspace,
    ) ?? {
      path: prefs.workspace,
      label: shortPathLabel(prefs.workspace),
      detail: prefs.workspace,
      kind: "selected",
      isDefault: false,
    }
  );
}

function profileById(
  profiles: ProfileSummary[],
  profileId: string | undefined,
): ProfileSummary | null {
  if (!profileId) return null;
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

function profileSupportsAgent(
  profile: ProfileSummary | null,
  agentId: string,
  prefs: LauncherPreferences | null,
): boolean {
  if (!profile || !agentId) return false;
  if (profile.launchTargets.some((target) => target.id === agentId))
    return true;
  if (!prefs || !isProxyAgent(agentId)) return false;
  const resolved = resolveProfileConnection(
    profile,
    prefs.profileConnections,
    agentConnectionDef(agentId),
  );
  return resolved.status !== "unsupported";
}

function profileAvailability(
  profile: ProfileSummary,
  agentId: string,
  prefs: LauncherPreferences,
  t: (
    key: string,
    vars?: Record<string, string | number | null | undefined>,
  ) => string,
): { launchable: boolean; reason?: string } {
  if (profileSupportsAgent(profile, agentId, prefs)) {
    return { launchable: true };
  }

  if (isProxyAgent(agentId)) {
    const resolved = resolveProfileConnection(
      profile,
      prefs.profileConnections,
      agentConnectionDef(agentId),
    );
    if (resolved.targetOptions.length > 0) {
      return {
        launchable: false,
        reason: t('Enable Proxy for "{{profile}}" to launch {{agent}}', {
          profile: profile.label,
          agent: agentLabel(agentId),
        }),
      };
    }
  }

  return {
    launchable: false,
    reason: t('"{{profile}}" does not support {{agent}}', {
      profile: profile.label,
      agent: agentLabel(agentId),
    }),
  };
}

function selectionUnavailableReason(
  choice: ProfileChoice,
  profile: ProfileSummary | null,
  agentId: string,
  prefs: LauncherPreferences,
  t: (
    key: string,
    vars?: Record<string, string | number | null | undefined>,
  ) => string,
): string | undefined {
  if (choice.kind === "direct") return undefined;
  if (!profile) return t("Selected profile is missing");
  return profileAvailability(profile, agentId, prefs, t).reason;
}

function profileSummary(
  profile: ProfileSummary,
  agentId: string,
  prefs: LauncherPreferences,
) {
  if (isProxyAgent(agentId)) {
    const resolved = resolveProfileConnection(
      profile,
      prefs.profileConnections,
      agentConnectionDef(agentId),
    );
    if (resolved.status === "via_proxy" && resolved.targetApiType) {
      return {
        title: profile.label,
        detail: profile.providerLabel,
        proxy: true,
        route: `${profile.providerLabel} -> ${agentLabel(agentId)} via ${apiTypeRouteLabel(resolved.targetApiType)}`,
      };
    }
    if (resolved.status === "native") {
      return {
        title: profile.label,
        detail: profile.providerLabel,
        proxy: false,
        route: `${profile.providerLabel} -> ${agentLabel(agentId)} native`,
      };
    }
    if (resolved.targetApiType) {
      return {
        title: profile.label,
        detail: profile.providerLabel,
        proxy: false,
        route: `${profile.providerLabel} -> ${agentLabel(agentId)} via ${apiTypeRouteLabel(resolved.targetApiType)} (proxy off)`,
      };
    }
  }
  const target = profile.launchTargets.find((target) => target.id === agentId);
  return {
    title: profile.label,
    detail: profile.providerLabel,
    proxy: false,
    route: target
      ? `${profile.providerLabel} -> ${agentLabel(agentId)} ${target.apiType}`
      : profile.providerLabel,
  };
}

function isSelectionLaunchable(
  choice: ProfileChoice,
  profile: ProfileSummary | null,
  agentId: string,
  prefs: LauncherPreferences,
): boolean {
  if (choice.kind === "direct") return true;
  return profileSupportsAgent(profile, agentId, prefs);
}

function agentConnectionDef(agentId: string): ConnectionAgentDef {
  if (agentId === "claude") {
    return {
      id: "claude",
      label: "Claude Code",
      requiredApiType: "anthropic",
      requiredProtocol: "Anthropic Messages",
      clientProtocol: "Claude Messages",
    };
  }
  return {
    id: "codex",
    label: "Codex CLI",
    requiredApiType: "openai-responses",
    requiredProtocol: "OpenAI Responses",
    clientProtocol: "Codex Responses",
  };
}

function isProxyAgent(agentId: string): agentId is ConnectionAgentId {
  return PROXY_AGENTS.has(agentId);
}

function agentSupportsSessionResume(agentId: string): boolean {
  return SESSION_RESUME_AGENTS.has(agentId);
}

function resolveSelectedSession(
  choice: SessionChoice,
  sessions: LaunchSessionSummary[],
): LaunchSessionSummary | null {
  if (choice?.kind === "session") {
    return (
      sessions.find((session) => session.sessionId === choice.sessionId) ??
      sessions[0] ??
      null
    );
  }
  return sessions[0] ?? null;
}

function relativeTime(updatedAt: number): string {
  if (!updatedAt) return "-";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - updatedAt);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(updatedAt * 1000).toLocaleDateString();
}

function shortPathLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function agentLabel(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
    case "cursor":
      return "Cursor";
    case "kiro":
      return "Kiro";
    case "qwen-code":
      return "Qwen";
    case "opencode":
      return "OpenCode";
    default:
      return agentId;
  }
}
