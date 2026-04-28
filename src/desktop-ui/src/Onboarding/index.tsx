import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Rocket } from "lucide-react";

import { STEPS } from "./constants";
import { StepAgents } from "./components/StepAgents";
import { StepChannels } from "./components/StepChannels";
import { StepConfirm } from "./components/StepConfirm";
import { StepTunnel } from "./components/StepTunnel";
import { StepWelcome } from "./components/StepWelcome";
import { useChannelAuth } from "./hooks/useChannelAuth";
import { useInstallFlow } from "./hooks/useInstallFlow";
import { buildSettings } from "./lib/buildSettings";
import {
  deleteProfile,
  listCatalog,
  listProfiles,
  upsertProfile,
} from "../Launch/api";
import { ProfileFormDialog } from "../Launch/ProfileFormDialog";
import type { CatalogEntry, ProfileDef, ProfileSummary } from "../Launch/types";
import type {
  AgentSummary,
  DiscoveredChannelPlugin,
  PluginRegistryEntry,
  Settings,
  TunnelSummary,
} from "./types";
import type { AgentId, TunnelProvider } from "./constants";

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<Settings>({});
  const [discoveredPlugins, setDiscoveredPlugins] = useState<DiscoveredChannelPlugin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);

  // Resource data from backend
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [tunnels, setTunnels] = useState<TunnelSummary[]>([]);
  const [pluginRegistry, setPluginRegistry] = useState<PluginRegistryEntry[]>([]);

  // Agents
  const [enabledAgents, setEnabledAgents] = useState<Set<AgentId>>(new Set());
  // Channels
  const [enabledChannels, setEnabledChannels] = useState<Set<string>>(new Set());
  const [channelConfigs, setChannelConfigs] = useState<Record<string, Record<string, string>>>({});
  const [installingPlugins, setInstallingPlugins] = useState<Set<string>>(new Set());

  // Tunnel
  const [tunnelProvider, setTunnelProvider] = useState<TunnelProvider>("cloudflare");
  const [ngrokToken, setNgrokToken] = useState("");
  const [ngrokDomain, setNgrokDomain] = useState("");
  const [cfToken, setCfToken] = useState("");
  const [cfHostname, setCfHostname] = useState("");

  // ---- Load existing settings + resources ----
  useEffect(() => {
    Promise.all([
      invoke<Settings>("get_settings"),
      invoke<DiscoveredChannelPlugin[]>("list_channel_plugins"),
      invoke<AgentSummary[]>("list_agents"),
      invoke<TunnelSummary[]>("list_tunnels"),
      invoke<PluginRegistryEntry[]>("list_plugin_registry"),
      listCatalog(),
      listProfiles(),
    ])
      .then(([loadedSettings, plugins, agentDefs, tunnelDefs, pluginDefs, catalogDefs, profileDefs]) => {
        setSettings(loadedSettings);
        setDiscoveredPlugins(plugins);
        setAgents(agentDefs);
        setTunnels(tunnelDefs);
        setPluginRegistry(pluginDefs);
        setCatalog(catalogDefs);
        setProfiles(profileDefs);

        if (loadedSettings.enabled_agents?.length) {
          setEnabledAgents(new Set(loadedSettings.enabled_agents as AgentId[]));
        } else {
          setEnabledAgents(new Set(agentDefs.map((a) => a.id)));
        }
        const channels = loadedSettings.channels ?? {};
        const enabled = new Set<string>();
        const configs: Record<string, Record<string, string>> = {};
        for (const [id, channelConfig] of Object.entries(channels)) {
          enabled.add(id);
          const configMap: Record<string, string> = {};
          for (const [key, value] of Object.entries(channelConfig)) {
            if (key !== "verbose" && typeof value === "string") {
              configMap[key] = value;
            }
          }
          configs[id] = configMap;
        }
        setEnabledChannels(enabled);
        setChannelConfigs(configs);

        const provider = loadedSettings.tunnel?.provider;
        if (
          provider === "none" ||
          provider === "cloudflare" ||
          provider === "ngrok" ||
          provider === "localtunnel"
        ) {
          setTunnelProvider(provider);
        }
        if (loadedSettings.tunnel?.ngrok?.auth_token) setNgrokToken(loadedSettings.tunnel.ngrok.auth_token);
        if (loadedSettings.tunnel?.ngrok?.domain) setNgrokDomain(loadedSettings.tunnel.ngrok.domain);
        if (loadedSettings.tunnel?.cloudflare?.tunnel_token) setCfToken(loadedSettings.tunnel.cloudflare.tunnel_token);
        if (loadedSettings.tunnel?.cloudflare?.hostname) setCfHostname(loadedSettings.tunnel.cloudflare.hostname);

        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // ---- Channel handlers ----
  const toggleChannel = useCallback((pluginId: string, enabled: boolean) => {
    setEnabledChannels((prev) => {
      const next = new Set(prev);
      if (enabled) next.add(pluginId);
      else next.delete(pluginId);
      return next;
    });
  }, []);

  const updateChannelConfig = useCallback((pluginId: string, key: string, value: string) => {
    setChannelConfigs((prev) => ({
      ...prev,
      [pluginId]: { ...(prev[pluginId] ?? {}), [key]: value },
    }));
  }, []);

  const installPlugin = useCallback(async (pluginId: string, githubUrl: string) => {
    setInstallingPlugins((prev) => new Set(prev).add(pluginId));
    try {
      await invoke("install_plugin", { request: { pluginId, githubUrl } });
      const plugins = await invoke<DiscoveredChannelPlugin[]>("list_channel_plugins");
      setDiscoveredPlugins(plugins);
    } catch (error) {
      console.error(`Failed to install plugin ${pluginId}:`, error);
    } finally {
      setInstallingPlugins((prev) => {
        const next = new Set(prev);
        next.delete(pluginId);
        return next;
      });
    }
  }, []);

  // ---- Auth flow + install orchestration (extracted hooks) ----
  const { authStates, startAuth, cancelAuth } = useChannelAuth({
    step,
    discoveredPlugins,
    channelConfigs,
    onConfigChange: updateChannelConfig,
  });

  const {
    finishing,
    isInstalling,
    installComplete,
    installTasks,
    startInstall,
    cancelInstall,
    completeInstall,
  } = useInstallFlow();

  const handleFinish = useCallback(() => {
    const finalSettings = buildSettings({
      settings,
      enabledAgents,
      enabledChannels,
      channelConfigs,
      discoveredPlugins,
      tunnelProvider,
      ngrokToken,
      ngrokDomain,
      cfToken,
      cfHostname,
    });
    void startInstall(finalSettings);
  }, [
    settings,
    enabledAgents,
    enabledChannels,
    channelConfigs,
    discoveredPlugins,
    tunnelProvider,
    ngrokToken,
    ngrokDomain,
    cfToken,
    cfHostname,
    startInstall,
  ]);

  const toggleAgent = useCallback((id: AgentId) => {
    setEnabledAgents((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSaveProfile = useCallback(
    async (profile: ProfileDef) => {
      await upsertProfile(profile);
      const nextProfiles = await listProfiles();
      setProfiles(nextProfiles);
    },
    [],
  );

  const handleDeleteProfile = useCallback(async (id: string) => {
    const profile = profiles.find((item) => item.id === id);
    if (profile && !window.confirm(`Delete profile "${profile.label}"?`)) return;
    await deleteProfile(id);
    const nextProfiles = await listProfiles();
    setProfiles(nextProfiles);
  }, [profiles]);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-muted-foreground animate-pulse">Loading…</span>
      </div>
    );
  }

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const canNext = currentStep !== "Quick Launch" || enabledAgents.size > 0;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-1 px-6 pt-5 pb-2">
        {STEPS.map((label, index) => (
          <div key={label} className="flex items-center gap-1 flex-1">
            <div
              className={`h-1 flex-1 rounded-full transition-colors ${
                index <= step ? "bg-primary" : "bg-border"
              }`}
            />
          </div>
        ))}
      </div>
      <div className="px-6 pb-3">
        <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
          Step {step + 1} of {STEPS.length} — {currentStep}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {currentStep === "Welcome" && <StepWelcome />}
        {currentStep === "Quick Launch" && (
          <StepAgents
            agents={agents}
            profiles={profiles}
            enabled={enabledAgents}
            onToggle={toggleAgent}
            onCreateProfile={() => setProfileEditorOpen(true)}
            onDeleteProfile={(id) => {
              void handleDeleteProfile(id);
            }}
          />
        )}
        {currentStep === "Channels" && (
          <StepChannels
            pluginRegistry={pluginRegistry}
            discoveredPlugins={discoveredPlugins}
            enabledChannels={enabledChannels}
            channelConfigs={channelConfigs}
            installingPlugins={installingPlugins}
            authStates={authStates}
            onToggleChannel={toggleChannel}
            onConfigChange={updateChannelConfig}
            onInstallPlugin={installPlugin}
            onStartAuth={startAuth}
            onCancelAuth={cancelAuth}
          />
        )}
        {currentStep === "Tunnel" && (
          <StepTunnel
            tunnels={tunnels}
            provider={tunnelProvider}
            onProvider={setTunnelProvider}
            ngrokToken={ngrokToken}
            onNgrokToken={setNgrokToken}
            ngrokDomain={ngrokDomain}
            onNgrokDomain={setNgrokDomain}
            cfToken={cfToken}
            onCfToken={setCfToken}
            cfHostname={cfHostname}
            onCfHostname={setCfHostname}
          />
        )}
        {currentStep === "Confirm" && (
          <StepConfirm
            agents={agents}
            tunnels={tunnels}
            pluginRegistry={pluginRegistry}
            enabledAgents={enabledAgents}
            tunnelProvider={tunnelProvider}
            enabledChannels={enabledChannels}
            isInstalling={isInstalling}
            installComplete={installComplete}
            installTasks={installTasks}
          />
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
        {isInstalling ? (
          <>
            <div />
            {installComplete ? (
              <button
                onClick={completeInstall}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <Rocket className="w-4 h-4" />
                {installTasks.some((task) =>
                  task.status === "error" || task.status === "cancelled"
                )
                  ? "Continue Anyway"
                  : "Open VibeAround"}
              </button>
            ) : (
              <button
                onClick={cancelInstall}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors"
              >
                Cancel
              </button>
            )}
          </>
        ) : (
          <>
            <button
              onClick={() => setStep((v) => Math.max(0, v - 1))}
              disabled={step === 0}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            {isLast ? (
              <button
                onClick={handleFinish}
                disabled={finishing}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {finishing ? (
                  <>Confirming…</>
                ) : (
                  <>
                    <Rocket className="w-4 h-4" />
                    Confirm
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={() => setStep((v) => Math.min(STEPS.length - 1, v + 1))}
                disabled={!canNext}
                className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {currentStep === "Welcome" ? "Get Started" : "Next"}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </>
        )}
      </div>

      {profileEditorOpen && (
        <ProfileFormDialog
          catalog={catalog}
          initial={null}
          onClose={() => setProfileEditorOpen(false)}
          onSave={handleSaveProfile}
        />
      )}
    </div>
  );
}
