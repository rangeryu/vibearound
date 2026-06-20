import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Bot,
  ChevronDown,
  ExternalLink,
  Globe,
  Loader2,
  RotateCw,
  Save,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { formatErrorMessage } from "@va/client";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { StatusBanner } from "@/components/page";
import { apiFetch, DAEMON_PORT, openDashboardUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AgentRuntime } from "./hooks/useAgentsRuntime";
import type { ChannelRuntime } from "./hooks/useChannelsState";
import type { TunnelRuntime } from "./hooks/useTunnelsState";
import type { Settings as AppSettings } from "./Onboarding/types";
import {
  getLauncherPreferences,
  type AgentSummary,
  listAgents,
  listLauncherWorkspaces,
  listProfiles,
  type LauncherPreferences,
  setLauncherDefault,
  setLauncherWorkspace,
  type WorkspaceOption,
} from "./Launch/api";
import type { ProfileSummary } from "./Launch/types";
import {
  agentProfileId,
  agentWorkspace,
  profileSupportsAgent,
} from "./Launch/launchModel";
import {
  basename,
  channelDisplayName,
  channelPresentation,
  shortId,
  tunnelDetail,
  tunnelPresentation,
} from "./status-dashboard/presentation";
import { ServiceIconBadge } from "./status-dashboard/serviceIcon";
import type { StatusDashboardProps, Tone } from "./status-dashboard/types";

const FOLLOW_DEFAULT = "__default__";
const DIRECT_PROFILE = "direct";
const UNSET_WORKSPACE = "__workspace_unset__";

type RemoteSelection =
  | { kind: "channel"; id: string }
  | { kind: "tunnel"; id: string };

type ChannelDefaultForm = {
  agentId: string;
  profileId: string;
  workspace: string;
};

type Notice = {
  variant: "success" | "warning" | "error";
  message: string;
};

type AppDefaultForm = {
  agentId: string;
  profileId: string;
  workspace: string;
};

type RemoteDashboardProps = StatusDashboardProps & {
  onConfigureChannel: (channelId: string) => void;
  onDefaultsChanged?: () => void;
};

type RemoteChannelDefaults = {
  agent_id?: string;
  agentId?: string;
  agent?: string;
  profile_id?: string;
  profileId?: string;
  profile?: string;
  workspace?: string;
  workspace_path?: string;
  workspacePath?: string;
};

type RemoteSettings = {
  channels?: Record<string, RemoteChannelDefaults>;
};

export function RemoteDashboard({
  channels,
  tunnels,
  agents,
  onConfigureChannel,
  onDefaultsChanged,
}: RemoteDashboardProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings>({});
  const [agentDefs, setAgentDefs] = useState<AgentSummary[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [prefs, setPrefs] = useState<LauncherPreferences | null>(null);
  const [appDefaultForm, setAppDefaultForm] = useState<AppDefaultForm>(() =>
    defaultAppDefaultForm(),
  );
  const [appWorkspaceOptions, setAppWorkspaceOptions] = useState<
    WorkspaceOption[]
  >([]);
  const [channelWorkspaceOptions, setChannelWorkspaceOptions] = useState<
    WorkspaceOption[]
  >([]);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const [savingAppDefault, setSavingAppDefault] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selection, setSelection] = useState<RemoteSelection | null>(null);

  const remoteSettings = useMemo(() => parseRemoteSettings(settings), [settings]);
  const configuredChannelIds = useMemo(() => {
    const ids = new Set<string>();
    channels.channels.forEach((channel) => ids.add(channel.kind));
    if (isRecord(settings.channels)) {
      Object.keys(settings.channels).forEach((id) => ids.add(id));
    }
    Object.keys(remoteSettings.channels ?? {}).forEach((id) => ids.add(id));
    return [...ids].sort((a, b) => channelDisplayName(a).localeCompare(channelDisplayName(b)));
  }, [channels.channels, remoteSettings.channels, settings.channels]);

  const channelById = useMemo(
    () => new Map(channels.channels.map((channel) => [channel.kind, channel])),
    [channels.channels],
  );
  const tunnelById = useMemo(
    () => new Map(tunnels.tunnels.map((tunnel) => [tunnel.provider, tunnel])),
    [tunnels.tunnels],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingSettings(true);
    setNotice(null);
    void Promise.all([
      invoke<AppSettings>("get_settings"),
      listAgents(),
      listProfiles(),
      getLauncherPreferences(),
    ])
      .then(([loadedSettings, loadedAgents, loadedProfiles, loadedPrefs]) => {
        if (cancelled) return;
        const orderedAgents = orderAgents(loadedAgents);
        setSettings(loadedSettings);
        setAgentDefs(orderedAgents);
        setProfiles(loadedProfiles);
        setPrefs(loadedPrefs);
        setAppDefaultForm(formForAppDefault(loadedPrefs, orderedAgents));
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice({ variant: "error", message: formatErrorMessage(error) });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSettings(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selection) return;
    if (configuredChannelIds.length > 0) {
      setSelection({ kind: "channel", id: configuredChannelIds[0] });
      return;
    }
    if (tunnels.tunnels.length > 0) {
      setSelection({ kind: "tunnel", id: tunnels.tunnels[0].provider });
    }
  }, [configuredChannelIds, selection, tunnels.tunnels]);

  const selectedChannel =
    selection?.kind === "channel" ? channelById.get(selection.id) ?? null : null;
  const selectedTunnel =
    selection?.kind === "tunnel" ? tunnelById.get(selection.id) ?? null : null;
  const selectedChannelId = selection?.kind === "channel" ? selection.id : null;
  const selectedChannelForm = selectedChannelId
    ? formForChannel(remoteSettings, selectedChannelId)
    : defaultChannelForm();

  const updateSelectedChannel = useCallback(
    (patch: Partial<ChannelDefaultForm>) => {
      if (!selectedChannelId) return;
      setSettings((previous) =>
        updateRemoteChannelForm(previous, selectedChannelId, {
          ...formForChannel(parseRemoteSettings(previous), selectedChannelId),
          ...patch,
        }),
      );
      setNotice(null);
    },
    [selectedChannelId],
  );

  useEffect(() => {
    if (!appDefaultForm.agentId) return;
    let cancelled = false;
    void listLauncherWorkspaces(appDefaultForm.agentId)
      .then((options) => {
        if (!cancelled) setAppWorkspaceOptions(options);
      })
      .catch(() => {
        if (!cancelled) setAppWorkspaceOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [appDefaultForm.agentId]);

  const saveSelectedChannel = useCallback(async () => {
    if (!selectedChannelId) return;
    setSavingChannel(selectedChannelId);
    setNotice(null);
    try {
      await invoke("save_settings", { settings });
      const response = await apiFetch("/api/settings/reload", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setNotice({ variant: "success", message: "Remote defaults saved." });
    } catch (error) {
      setNotice({ variant: "error", message: formatErrorMessage(error) });
    } finally {
      setSavingChannel(null);
    }
  }, [selectedChannelId, settings]);

  const defaultAgent = prefs?.defaultAgent ?? agentDefs[0]?.id ?? "codex";
  const defaultWorkspace = prefs ? agentWorkspace(prefs, defaultAgent) : "";
  const enabledAgents =
    prefs?.enabledAgents.length
      ? agentDefs.filter((agent) => prefs.enabledAgents.includes(agent.id))
      : agentDefs;
  const selectedAgentId =
    selectedChannelForm.agentId === FOLLOW_DEFAULT
      ? defaultAgent
      : selectedChannelForm.agentId;
  const selectedProfileId =
    selectedChannelForm.profileId === FOLLOW_DEFAULT
      ? prefs
        ? agentProfileId(prefs, selectedAgentId) ?? DIRECT_PROFILE
        : DIRECT_PROFILE
      : selectedChannelForm.profileId;
  const selectedWorkspace =
    selectedChannelForm.workspace === FOLLOW_DEFAULT
      ? prefs
        ? agentWorkspace(prefs, selectedAgentId)
        : defaultWorkspace
      : selectedChannelForm.workspace;
  const profileOptions = profiles.filter((profile) =>
    prefs ? profileSupportsAgent(profile, selectedAgentId, prefs) : true,
  );
  useEffect(() => {
    if (!selectedAgentId) return;
    let cancelled = false;
    void listLauncherWorkspaces(selectedAgentId)
      .then((options) => {
        if (!cancelled) setChannelWorkspaceOptions(options);
      })
      .catch(() => {
        if (!cancelled) setChannelWorkspaceOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAgentId]);

  const workspaceOptions = workspaceOptionsFor(
    channelWorkspaceOptions,
    selectedWorkspace,
  );
  const appDefaultAgentId = appDefaultForm.agentId || defaultAgent;
  const appDefaultAgentDef = agentDefs.find(
    (agent) => agent.id === appDefaultAgentId,
  );
  const appDefaultProfileLabel =
    appDefaultForm.profileId === DIRECT_PROFILE
      ? t("Direct")
      : profiles.find((profile) => profile.id === appDefaultForm.profileId)?.label ??
        appDefaultForm.profileId;
  const appDefaultProfileOptions = profiles.filter((profile) =>
    prefs ? profileSupportsAgent(profile, appDefaultAgentId, prefs) : true,
  );
  const appDefaultWorkspaceOptions = workspaceOptionsFor(
    appWorkspaceOptions,
    appDefaultForm.workspace,
  );
  const activeAgentsForChannel = selectedChannelId
    ? agents.agents.filter((agent) => agentRuntimeTouchesChannel(agent, selectedChannelId))
    : [];

  const updateAppDefaultAgent = useCallback(
    (agentId: string) => {
      const profileId = prefs ? agentProfileId(prefs, agentId) ?? DIRECT_PROFILE : DIRECT_PROFILE;
      const workspace = prefs ? agentWorkspace(prefs, agentId) : appDefaultForm.workspace;
      setAppDefaultForm({ agentId, profileId, workspace });
      setNotice(null);
    },
    [appDefaultForm.workspace, prefs],
  );

  const saveAppDefault = useCallback(async () => {
    if (!appDefaultForm.agentId) return;
    setSavingAppDefault(true);
    setNotice(null);
    try {
      await setLauncherDefault(
        appDefaultForm.agentId,
        appDefaultForm.profileId === DIRECT_PROFILE ? null : appDefaultForm.profileId,
      );
      if (appDefaultForm.workspace) {
        await setLauncherWorkspace(appDefaultForm.workspace, appDefaultForm.agentId);
      }
      const nextPrefs = await getLauncherPreferences();
      setPrefs(nextPrefs);
      setAppDefaultForm(formForAppDefault(nextPrefs, agentDefs));
      onDefaultsChanged?.();
      setNotice({ variant: "success", message: "App defaults saved." });
    } catch (error) {
      setNotice({ variant: "error", message: formatErrorMessage(error) });
    } finally {
      setSavingAppDefault(false);
    }
  }, [agentDefs, appDefaultForm, onDefaultsChanged]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/15">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Globe className="h-4 w-4 shrink-0 text-primary" />
          <span className="shrink-0 font-semibold">{t("Remote Access")}</span>
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {t("Configure messaging apps and remote access.")}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2 text-[11px] text-primary hover:text-primary"
          onClick={() =>
            void openDashboardUrl(`http://127.0.0.1:${DAEMON_PORT}/va/`)
          }
        >
          {t("Open Web Dashboard")}
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </header>

      {notice && (
        <div className="shrink-0 border-b border-border bg-background px-4 py-2">
          <StatusBanner className="max-w-[960px]" variant={notice.variant}>
            {t(notice.message)}
          </StatusBanner>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[272px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-border bg-background/70">
          <div className="shrink-0 border-b border-border px-3 py-2.5">
            <AppDefaultEditor
              form={appDefaultForm}
              agentLabel={appDefaultAgentDef?.display_name ?? appDefaultAgentId}
              profileLabel={appDefaultProfileLabel}
              defaultWorkspace={appDefaultForm.workspace}
              enabledAgents={enabledAgents}
              profileOptions={appDefaultProfileOptions}
              workspaceOptions={appDefaultWorkspaceOptions}
              saving={savingAppDefault}
              onAgentChange={updateAppDefaultAgent}
              onProfileChange={(profileId) => {
                setAppDefaultForm((form) => ({ ...form, profileId }));
                setNotice(null);
              }}
              onWorkspaceChange={(workspace) => {
                setAppDefaultForm((form) => ({ ...form, workspace }));
                setNotice(null);
              }}
              onSave={() => void saveAppDefault()}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5 [scrollbar-gutter:stable]">
              <RemoteSidebarSection
                title={t("Messaging apps")}
                count={configuredChannelIds.length}
              >
                {configuredChannelIds.length === 0 ? (
                  <EmptySidebarItem label={t("No messaging apps enabled")} />
                ) : (
                  configuredChannelIds.map((id) => {
                    const channel = channelById.get(id);
                    const presentation = channel
                      ? channelPresentation(channel.status, t)
                      : { label: t("Configured"), tone: "muted" as Tone };
                    const form = formForChannel(remoteSettings, id);
                    const summary = channelDefaultSummary({
                      form,
                      prefs,
                      agentDefs,
                      profiles,
                      defaultAgent,
                      defaultWorkspace,
                      t,
                    });
                    return (
                      <SidebarButton
                        key={id}
                        active={selection?.kind === "channel" && selection.id === id}
                        icon={
                          <ServiceIconBadge
                            id={id}
                            kind="channel"
                            tone={presentation.tone}
                          />
                        }
                        title={channelDisplayName(id)}
                        detail={summary}
                        onClick={() => setSelection({ kind: "channel", id })}
                      />
                    );
                  })
                )}
              </RemoteSidebarSection>

              <RemoteSidebarSection
                title={t("Remote access")}
                count={tunnels.tunnels.length}
                className="mt-5"
              >
                {tunnels.tunnels.length === 0 ? (
                  <EmptySidebarItem label={t("No tunnel running")} />
                ) : (
                  tunnels.tunnels.map((tunnel) => {
                    const presentation = tunnelPresentation(tunnel.status, t);
                    return (
                      <SidebarButton
                        key={tunnel.provider}
                        active={
                          selection?.kind === "tunnel" &&
                          selection.id === tunnel.provider
                        }
                        icon={
                          <ServiceIconBadge
                            id={tunnel.provider}
                            kind="tunnel"
                            tone={presentation.tone}
                          />
                        }
                        title={t("{{provider}} tunnel", {
                          provider: capitalize(tunnel.provider),
                        })}
                        detail={tunnel.url ?? tunnelDetail(tunnel.status) ?? ""}
                        onClick={() =>
                          setSelection({ kind: "tunnel", id: tunnel.provider })
                        }
                      />
                    );
                  })
                )}
              </RemoteSidebarSection>
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto px-6 py-5 [scrollbar-gutter:stable]">
            {loadingSettings ? (
              <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                {t("Loading…")}
              </div>
            ) : selectedChannelId ? (
              <div className="mx-auto max-w-[960px]">
                <ChannelRemoteDetail
                  channelId={selectedChannelId}
                  channel={selectedChannel}
                  form={selectedChannelForm}
                  enabledAgents={enabledAgents}
                  selectedAgentId={selectedAgentId}
                  selectedProfileId={selectedProfileId}
                  selectedWorkspace={selectedWorkspace}
                  profileOptions={profileOptions}
                  workspaceOptions={workspaceOptions}
                  activeAgents={activeAgentsForChannel}
                  pluginDir={selectedChannel?.plugin_dir ?? null}
                  saving={savingChannel === selectedChannelId}
                  onAgentChange={(agentId) =>
                    updateSelectedChannel({ agentId, profileId: FOLLOW_DEFAULT })
                  }
                  onProfileChange={(profileId) =>
                    updateSelectedChannel({ profileId })
                  }
                  onWorkspaceChange={(workspace) =>
                    updateSelectedChannel({ workspace })
                  }
                  onSave={() => void saveSelectedChannel()}
                  onConfigure={() => onConfigureChannel(selectedChannelId)}
                  onStart={() => channels.start(selectedChannelId)}
                  onStop={() => channels.stop(selectedChannelId)}
                  onRestart={() => channels.restart(selectedChannelId)}
                />
              </div>
            ) : selectedTunnel ? (
              <div className="mx-auto max-w-[960px]">
                <TunnelRemoteDetail
                  tunnel={selectedTunnel}
                  onKill={() => tunnels.kill(selectedTunnel.provider)}
                />
              </div>
            ) : (
              <div className="mx-auto max-w-[960px] rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                {t("Select a remote entry.")}
              </div>
            )}
          </main>
        </div>
    </div>
  );
}

function AppDefaultEditor({
  form,
  agentLabel,
  profileLabel,
  defaultWorkspace,
  enabledAgents,
  profileOptions,
  workspaceOptions,
  saving,
  onAgentChange,
  onProfileChange,
  onWorkspaceChange,
  onSave,
}: {
  form: AppDefaultForm;
  agentLabel: string;
  profileLabel: string;
  defaultWorkspace: string;
  enabledAgents: AgentSummary[];
  profileOptions: ProfileSummary[];
  workspaceOptions: WorkspaceOption[];
  saving: boolean;
  onAgentChange: (agentId: string) => void;
  onProfileChange: (profileId: string) => void;
  onWorkspaceChange: (workspace: string) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const workspaceValue = form.workspace || UNSET_WORKSPACE;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
      <div className="flex items-center gap-2">
        <BrandIcon
          kind="cli"
          id={form.agentId}
          label={agentLabel}
          className="h-5 w-5"
        />
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-expanded={open}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {t("App defaults")}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {agentLabel} · {profileLabel} ·{" "}
                {defaultWorkspace || t("Default workspace")}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="space-y-2 pt-1">
        <div className="grid gap-2">
          <SelectField label={t("Agent")}>
            <Select value={form.agentId} onValueChange={onAgentChange}>
              <SelectTrigger className="h-8 w-full bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {enabledAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SelectField>

          <SelectField label={t("Profile")}>
            <Select value={form.profileId} onValueChange={onProfileChange}>
              <SelectTrigger className="h-8 w-full bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DIRECT_PROFILE}>{t("Direct")}</SelectItem>
                {profileOptions.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SelectField>

          <SelectField label={t("Workspace")}>
            <Select
              value={workspaceValue}
              onValueChange={(workspace) => {
                if (workspace !== UNSET_WORKSPACE) onWorkspaceChange(workspace);
              }}
            >
              <SelectTrigger className="h-8 w-full bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!form.workspace && (
                  <SelectItem value={UNSET_WORKSPACE} disabled>
                    {t("Default workspace")}
                  </SelectItem>
                )}
                {workspaceOptions.map((workspace) => (
                  <SelectItem key={workspace.path} value={workspace.path}>
                    {workspace.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SelectField>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
            disabled={saving}
            onClick={onSave}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saving ? t("Saving…") : t("Save")}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ChannelRemoteDetail({
  channelId,
  channel,
  form,
  enabledAgents,
  selectedAgentId,
  selectedProfileId,
  selectedWorkspace,
  profileOptions,
  workspaceOptions,
  activeAgents,
  pluginDir,
  saving,
  onAgentChange,
  onProfileChange,
  onWorkspaceChange,
  onSave,
  onConfigure,
  onStart,
  onStop,
  onRestart,
}: {
  channelId: string;
  channel: ChannelRuntime | null;
  form: ChannelDefaultForm;
  enabledAgents: AgentSummary[];
  selectedAgentId: string;
  selectedProfileId: string;
  selectedWorkspace: string;
  profileOptions: ProfileSummary[];
  workspaceOptions: WorkspaceOption[];
  activeAgents: AgentRuntime[];
  pluginDir: string | null;
  saving: boolean;
  onAgentChange: (agentId: string) => void;
  onProfileChange: (profileId: string) => void;
  onWorkspaceChange: (workspace: string) => void;
  onSave: () => void;
  onConfigure: () => void;
  onStart: () => unknown;
  onStop: () => unknown;
  onRestart: () => unknown;
}) {
  const { t } = useI18n();
  const presentation = channel
    ? channelPresentation(channel.status, t)
    : { label: t("Configured"), tone: "muted" as Tone };
  const running = channel?.status === "running" || channel?.status === "spawning";

  return (
    <div className="grid gap-4">
      <section className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
            <ServiceIconBadge
              id={channelId}
              kind="channel"
              tone={presentation.tone}
              showStatus={false}
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold">
                {channelDisplayName(channelId)}
              </h1>
              <span
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[11px]",
                  toneBadgeClass(presentation.tone),
                )}
              >
                {presentation.label}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {channel?.version ? `v${channel.version}` : t("Plugin status")}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-primary">
            {running ? t("Enabled") : t("Disabled")}
          </span>
          <Switch
            checked={running}
            onCheckedChange={(checked) => {
              if (checked) onStart();
              else onStop();
            }}
            size="sm"
            aria-label={t("Toggle channel")}
          />
        </div>
      </section>

      <section className="rounded-md border border-border bg-card px-3 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold">
            <Bot className="h-3.5 w-3.5 text-primary" />
            {t("This channel's default session")}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={onConfigure}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t("Configure")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={onRestart}
            >
              <RotateCw className="h-3.5 w-3.5" />
              {t("Restart")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {saving ? t("Saving…") : t("Save")}
            </Button>
          </div>
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          <SelectField label={t("Agent")}>
            <Select value={form.agentId} onValueChange={onAgentChange}>
              <SelectTrigger className="h-8 w-full bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_DEFAULT}>{t("Follow app default")}</SelectItem>
                {enabledAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SelectField>
          <SelectField label={t("Profile")}>
            <Select value={form.profileId} onValueChange={onProfileChange}>
              <SelectTrigger className="h-8 w-full bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_DEFAULT}>{t("Follow agent default")}</SelectItem>
                <SelectItem value={DIRECT_PROFILE}>{t("Direct")}</SelectItem>
                {profileOptions.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SelectField>
          <SelectField label={t("Workspace")}>
            <Select value={form.workspace} onValueChange={onWorkspaceChange}>
              <SelectTrigger className="h-8 w-full bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_DEFAULT}>{t("Follow agent default")}</SelectItem>
                {workspaceOptions.map((workspace) => (
                  <SelectItem key={workspace.path} value={workspace.path}>
                    {workspace.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SelectField>
        </div>
        <div className="mt-3 border-t border-border/70 pt-2.5">
          <div className="grid gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-[auto_minmax(0,1fr)]">
            <span className="font-medium text-foreground">
              {t("Plugin directory")}
            </span>
            <span className="min-w-0 truncate font-mono text-foreground">
              {pluginDir ?? t("Unavailable")}
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-md border border-border bg-card px-3 py-3">
          <div className="mb-2 text-xs font-semibold">{t("Current setting")}</div>
          <div className="space-y-2">
            <KeyValue label={t("Agent")} value={selectedAgentId} />
            <KeyValue label={t("Profile")} value={selectedProfileId} />
            <KeyValue label={t("Workspace")} value={selectedWorkspace || t("Default workspace")} />
            {channel?.reason && <KeyValue label={t("Reason")} value={channel.reason} danger />}
          </div>
        </section>

        <section className="rounded-md border border-border bg-card px-3 py-3">
          <div className="mb-2 text-xs font-semibold">{t("Active sessions")}</div>
          {activeAgents.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              {t("No active agent session for this channel.")}
            </div>
          ) : (
            <div className="grid gap-1.5">
              {activeAgents.map((agent) => (
                <div
                  key={agent.route_key}
                  className="flex min-h-[42px] items-center justify-between gap-3 rounded-md border border-border/70 px-2 py-1.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <BrandIcon
                      kind="cli"
                      id={agent.cli_kind ?? selectedAgentId}
                      label={agent.agent_title ?? agent.agent_name ?? agent.cli_kind ?? ""}
                      className="h-6 w-6"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">
                        {agent.agent_title ?? agent.agent_name ?? agent.cli_kind}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {agent.session_id ? shortId(agent.session_id) : t("No session yet")} ·{" "}
                        {agent.workspace ? basename(agent.workspace) : t("Workspace")}
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {agent.busy ? t("Busy") : t("Idle")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TunnelRemoteDetail({
  tunnel,
  onKill,
}: {
  tunnel: TunnelRuntime;
  onKill: () => unknown;
}) {
  const { t } = useI18n();
  const presentation = tunnelPresentation(tunnel.status, t);
  const detail = tunnelDetail(tunnel.status);
  return (
    <div className="grid gap-4">
      <section className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card">
            <ServiceIconBadge
              id={tunnel.provider}
              kind="tunnel"
              tone={presentation.tone}
              showStatus={false}
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold">
                {t("{{provider}} tunnel", { provider: capitalize(tunnel.provider) })}
              </h1>
              <span
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[11px]",
                  toneBadgeClass(presentation.tone),
                )}
              >
                {presentation.label}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {tunnel.url ?? detail ?? t("No public URL")}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {tunnel.url && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={() => void openDashboardUrl(tunnel.url!)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("Open")}
            </Button>
          )}
          {tunnel.status.state === "running" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={onKill}
            >
              <Square className="h-3.5 w-3.5" />
              {t("Stop")}
            </Button>
          )}
        </div>
      </section>

      <section className="rounded-md border border-border bg-card px-3 py-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
          <Globe className="h-3.5 w-3.5 text-primary" />
          {t("Tunnel information")}
        </div>
        <div className="space-y-2">
          <KeyValue label={t("Provider")} value={tunnel.provider} />
          <KeyValue label={t("Status")} value={presentation.label} />
          <KeyValue label={t("Public URL")} value={tunnel.url ?? t("Unavailable")} />
          <KeyValue label={t("Uptime")} value={`${tunnel.uptime_secs}s`} />
          {detail && <KeyValue label={t("Reason")} value={detail} danger />}
        </div>
      </section>
    </div>
  );
}

function RemoteSidebarSection({
  title,
  count,
  className,
  children,
}: {
  title: string;
  count: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("mb-4", className)}>
      <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-medium text-muted-foreground">
        <span>{title}</span>
        <span>{count}</span>
      </div>
      <div className="grid gap-1.5">{children}</div>
    </section>
  );
}

function SidebarButton({
  active,
  icon,
  title,
  detail,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-[46px] w-full items-center gap-2 rounded-md border px-2 text-left transition-colors",
        active
          ? "border-primary bg-card shadow-[inset_3px_0_0_hsl(var(--primary))]"
          : "border-transparent hover:border-border hover:bg-card",
      )}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block">
          <span className="truncate text-xs font-semibold">{title}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {detail}
        </span>
      </span>
    </button>
  );
}

function EmptySidebarItem({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}

function SelectField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function KeyValue({
  label,
  value,
  danger,
}: {
  label: string;
  value: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-start gap-3 border-b border-border/70 pb-1.5 last:border-b-0 last:pb-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("min-w-0 break-words text-xs", danger && "text-destructive")}>
        {value}
      </div>
    </div>
  );
}

function parseRemoteSettings(settings: AppSettings): RemoteSettings {
  const remote = isRecord(settings.remote) ? settings.remote : {};
  const channels = isRecord(remote.channels) ? remote.channels : {};
  const parsedChannels: Record<string, RemoteChannelDefaults> = {};
  for (const [id, value] of Object.entries(channels)) {
    if (isRecord(value)) parsedChannels[id] = value as RemoteChannelDefaults;
  }
  return { channels: parsedChannels };
}

function formForChannel(
  remote: RemoteSettings,
  channelId: string,
): ChannelDefaultForm {
  const entry = remote.channels?.[channelId] ?? {};
  return {
    agentId: stringValue(entry.agent_id ?? entry.agentId ?? entry.agent) ?? FOLLOW_DEFAULT,
    profileId:
      stringValue(entry.profile_id ?? entry.profileId ?? entry.profile) ?? FOLLOW_DEFAULT,
    workspace:
      stringValue(entry.workspace ?? entry.workspace_path ?? entry.workspacePath) ??
      FOLLOW_DEFAULT,
  };
}

function formForAppDefault(
  prefs: LauncherPreferences | null,
  agents: AgentSummary[],
): AppDefaultForm {
  const agentId = prefs?.defaultAgent ?? agents[0]?.id ?? "codex";
  return {
    agentId,
    profileId: prefs?.defaultProfileId ?? DIRECT_PROFILE,
    workspace: prefs ? agentWorkspace(prefs, agentId) : "",
  };
}

function defaultChannelForm(): ChannelDefaultForm {
  return {
    agentId: FOLLOW_DEFAULT,
    profileId: FOLLOW_DEFAULT,
    workspace: FOLLOW_DEFAULT,
  };
}

function defaultAppDefaultForm(): AppDefaultForm {
  return {
    agentId: "codex",
    profileId: DIRECT_PROFILE,
    workspace: "",
  };
}

function updateRemoteChannelForm(
  settings: AppSettings,
  channelId: string,
  form: ChannelDefaultForm,
): AppSettings {
  const result: AppSettings = { ...settings };
  const remote = isRecord(settings.remote) ? { ...settings.remote } : {};
  const existingChannels = isRecord(remote.channels) ? remote.channels : {};
  const channels: Record<string, RemoteChannelDefaults> = {};
  for (const [id, value] of Object.entries(existingChannels)) {
    if (isRecord(value)) channels[id] = { ...(value as RemoteChannelDefaults) };
  }

  const entry: RemoteChannelDefaults = { ...(channels[channelId] ?? {}) };
  for (const key of ["agent", "agentId", "profile", "profileId", "workspacePath"] as const) {
    delete entry[key];
  }
  if (form.agentId === FOLLOW_DEFAULT) delete entry.agent_id;
  else entry.agent_id = form.agentId;
  if (form.profileId === FOLLOW_DEFAULT) delete entry.profile_id;
  else entry.profile_id = form.profileId;
  if (form.workspace === FOLLOW_DEFAULT) delete entry.workspace;
  else entry.workspace = form.workspace;

  if (Object.keys(entry).length > 0) channels[channelId] = entry;
  else delete channels[channelId];

  if (Object.keys(channels).length > 0) {
    remote.channels = channels;
  } else {
    delete remote.channels;
  }

  if (Object.keys(remote).length > 0) {
    result.remote = remote;
  } else {
    delete result.remote;
  }
  return result;
}

function channelDefaultSummary({
  form,
  prefs,
  agentDefs,
  profiles,
  defaultAgent,
  defaultWorkspace,
  t,
}: {
  form: ChannelDefaultForm;
  prefs: LauncherPreferences | null;
  agentDefs: AgentSummary[];
  profiles: ProfileSummary[];
  defaultAgent: string;
  defaultWorkspace: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const agentId = form.agentId === FOLLOW_DEFAULT ? defaultAgent : form.agentId;
  const agent = agentDefs.find((item) => item.id === agentId);
  const profileId =
    form.profileId === FOLLOW_DEFAULT
      ? prefs
        ? agentProfileId(prefs, agentId)
        : undefined
      : form.profileId;
  const profile =
    profileId && profileId !== DIRECT_PROFILE
      ? profiles.find((item) => item.id === profileId)?.label ?? profileId
      : t("Direct");
  const workspace =
    form.workspace === FOLLOW_DEFAULT
      ? prefs
        ? agentWorkspace(prefs, agentId)
        : defaultWorkspace
      : form.workspace;
  return `${agent?.display_name ?? agentId} · ${profile} · ${basename(workspace || t("Workspace"))}`;
}

function workspaceOptionsFor(
  options: WorkspaceOption[],
  selectedWorkspace: string,
): WorkspaceOption[] {
  if (!selectedWorkspace || options.some((option) => option.path === selectedWorkspace)) {
    return options;
  }
  return [
    ...options,
    {
      path: selectedWorkspace,
      label: basename(selectedWorkspace),
      detail: selectedWorkspace,
      kind: "selected",
      isDefault: false,
    },
  ];
}

function agentRuntimeTouchesChannel(agent: AgentRuntime, channelId: string) {
  if (agent.channel_kind === channelId) return true;
  return agent.attached_routes.some((route) => route.channel_kind === channelId);
}

function orderAgents(agents: AgentSummary[]) {
  const order = ["claude", "codex", "pi", "gemini", "opencode", "cursor", "kiro", "qwen-code"];
  return [...agents].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.display_name.localeCompare(b.display_name);
  });
}

function toneBadgeClass(tone: Tone) {
  switch (tone) {
    case "good":
      return "border-emerald-500/30 bg-emerald-50 text-emerald-700";
    case "busy":
      return "border-blue-500/30 bg-blue-50 text-blue-700";
    case "warning":
      return "border-amber-500/30 bg-amber-50 text-amber-700";
    case "danger":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "muted":
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}
