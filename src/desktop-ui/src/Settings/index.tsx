import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Globe,
  MessageSquare,
  RotateCw,
  Settings as SettingsIcon,
  WandSparkles,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { StepChannels } from "../Onboarding/components/StepChannels";
import { StepTunnel } from "../Onboarding/components/StepTunnel";
import { useChannelAuth } from "../Onboarding/hooks/useChannelAuth";
import type { TunnelProvider } from "../Onboarding/constants";
import type {
  ChannelVerboseConfig,
  ConfigSchemaProperty,
  DiscoveredChannelPlugin,
  PluginRegistryEntry,
  Settings as AppSettings,
  TunnelSummary,
} from "../Onboarding/types";
import { apiFetch } from "../lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBanner } from "@/components/page";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServicesRestarted?: () => void;
}

type Notice = {
  variant: "success" | "warning" | "error";
  message: string;
};

type SaveState =
  | "idle"
  | "im"
  | "tunnel"
  | "tunnel-restart"
  | "restart-services";

export function SettingsDialog({
  open,
  onOpenChange,
  onServicesRestarted,
}: SettingsDialogProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings>({});
  const [pluginRegistry, setPluginRegistry] = useState<PluginRegistryEntry[]>([]);
  const [discoveredPlugins, setDiscoveredPlugins] = useState<
    DiscoveredChannelPlugin[]
  >([]);
  const [tunnels, setTunnels] = useState<TunnelSummary[]>([]);
  const [enabledChannels, setEnabledChannels] = useState<Set<string>>(
    () => new Set(),
  );
  const [channelConfigs, setChannelConfigs] = useState<
    Record<string, Record<string, string>>
  >({});
  const [channelVerbose, setChannelVerbose] = useState<
    Record<string, ChannelVerboseConfig>
  >({});
  const [tunnelProvider, setTunnelProvider] =
    useState<TunnelProvider>("none");
  const [ngrokToken, setNgrokToken] = useState("");
  const [ngrokDomain, setNgrokDomain] = useState("");
  const [cfToken, setCfToken] = useState("");
  const [cfHostname, setCfHostname] = useState("");
  const [installingPlugins, setInstallingPlugins] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saving, setSaving] = useState<SaveState>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);

  const hydrateChannels = useCallback(
    (
      loadedSettings: AppSettings,
      registry: PluginRegistryEntry[],
      discovered: DiscoveredChannelPlugin[],
    ) => {
      const knownIds = new Set([
        ...registry.map((plugin) => plugin.id),
        ...discovered.map((plugin) => plugin.id),
      ]);
      const channels = isRecord(loadedSettings.channels)
        ? loadedSettings.channels
        : {};
      const enabled = new Set<string>();
      const configs: Record<string, Record<string, string>> = {};
      const verbose: Record<string, ChannelVerboseConfig> = {};

      for (const [id, channelConfig] of Object.entries(channels)) {
        if (!knownIds.has(id) || !isRecord(channelConfig)) continue;
        enabled.add(id);
        const configMap: Record<string, string> = {};
        for (const [key, value] of Object.entries(channelConfig)) {
          if (key !== "verbose" && typeof value === "string") {
            configMap[key] = value;
          }
        }
        configs[id] = configMap;
        verbose[id] = parseChannelVerbose(channelConfig.verbose);
      }

      setEnabledChannels(enabled);
      setChannelConfigs(configs);
      setChannelVerbose(verbose);
    },
    [],
  );

  const hydrateTunnel = useCallback((loadedSettings: AppSettings) => {
    const tunnel = loadedSettings.tunnel;
    setTunnelProvider(tunnel?.provider ?? "none");
    setNgrokToken(tunnel?.ngrok?.auth_token ?? "");
    setNgrokDomain(tunnel?.ngrok?.domain ?? "");
    setCfToken(tunnel?.cloudflare?.tunnel_token ?? "");
    setCfHostname(tunnel?.cloudflare?.hostname ?? "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setSettingsLoaded(false);
    setNotice(null);
    try {
      const [loadedSettings, registry, discovered, tunnelDefs] =
        await Promise.all([
          invoke<AppSettings>("get_settings"),
          invoke<PluginRegistryEntry[]>("list_plugin_registry"),
          invoke<DiscoveredChannelPlugin[]>("list_channel_plugins"),
          invoke<TunnelSummary[]>("list_tunnels"),
        ]);
      setSettings(loadedSettings);
      setPluginRegistry(registry);
      setDiscoveredPlugins(discovered);
      setTunnels(tunnelDefs);
      hydrateChannels(loadedSettings, registry, discovered);
      hydrateTunnel(loadedSettings);
      setSettingsLoaded(true);
    } catch (error) {
      setNotice({
        variant: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [hydrateChannels, hydrateTunnel]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const updateChannelConfig = useCallback(
    (pluginId: string, key: string, value: string) => {
      setChannelConfigs((prev) => ({
        ...prev,
        [pluginId]: { ...(prev[pluginId] ?? {}), [key]: value },
      }));
    },
    [],
  );

  const updateChannelVerbose = useCallback(
    (
      pluginId: string,
      key: keyof ChannelVerboseConfig,
      value: boolean,
    ) => {
      setChannelVerbose((prev) => ({
        ...prev,
        [pluginId]: {
          ...(prev[pluginId] ?? defaultChannelVerbose()),
          [key]: value,
        },
      }));
    },
    [],
  );

  const toggleChannel = useCallback((pluginId: string, enabled: boolean) => {
    setEnabledChannels((prev) => {
      const next = new Set(prev);
      if (enabled) next.add(pluginId);
      else next.delete(pluginId);
      return next;
    });
    if (enabled) {
      setChannelVerbose((prev) =>
        prev[pluginId] ? prev : { ...prev, [pluginId]: defaultChannelVerbose() },
      );
    }
  }, []);

  const installPlugin = useCallback(
    async (pluginId: string, githubUrl: string) => {
      setInstallingPlugins((prev) => new Set(prev).add(pluginId));
      setNotice(null);
      try {
        await invoke("install_plugin", { request: { pluginId, githubUrl } });
        const plugins = await invoke<DiscoveredChannelPlugin[]>(
          "list_channel_plugins",
        );
        setDiscoveredPlugins(plugins);
      } catch (error) {
        setNotice({
          variant: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setInstallingPlugins((prev) => {
          const next = new Set(prev);
          next.delete(pluginId);
          return next;
        });
      }
    },
    [],
  );

  const { authStates, startAuth, cancelAuth } = useChannelAuth({
    active: open,
    discoveredPlugins,
    channelConfigs,
    onConfigChange: updateChannelConfig,
  });

  const canSubmit = useMemo(
    () => settingsLoaded && !loading && saving === "idle",
    [settingsLoaded, loading, saving],
  );

  const restartServices = useCallback(async () => {
    setSaving("restart-services");
    setNotice(null);
    try {
      await invoke("restart_services");
      onServicesRestarted?.();
      setNotice({ variant: "success", message: "Services restarted." });
    } catch (error) {
      setNotice({
        variant: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving("idle");
    }
  }, [onServicesRestarted]);

  const applyImSettings = useCallback(async () => {
    setSaving("im");
    setNotice(null);
    try {
      const nextSettings = buildChannelSettings({
        settings,
        pluginRegistry,
        discoveredPlugins,
        enabledChannels,
        channelConfigs,
        channelVerbose,
      });
      await invoke("save_settings", { settings: nextSettings });
      setSettings(nextSettings);
      const response = await apiFetch("/api/channels/sync", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onServicesRestarted?.();
      setNotice({ variant: "success", message: "IM settings applied." });
    } catch (error) {
      setNotice({
        variant: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving("idle");
    }
  }, [
    settings,
    pluginRegistry,
    discoveredPlugins,
    enabledChannels,
    channelConfigs,
    channelVerbose,
    onServicesRestarted,
  ]);

  const saveTunnelSettings = useCallback(
    async (restart: boolean) => {
      setSaving(restart ? "tunnel-restart" : "tunnel");
      setNotice(null);
      try {
        const nextSettings = buildTunnelSettings({
          settings,
          tunnelProvider,
          ngrokToken,
          ngrokDomain,
          cfToken,
          cfHostname,
        });
        await invoke("save_settings", { settings: nextSettings });
        setSettings(nextSettings);

        if (restart) {
          await invoke("restart_services");
          onServicesRestarted?.();
          setNotice({ variant: "success", message: "Tunnel settings applied." });
        } else {
          setNotice({ variant: "success", message: "Tunnel settings saved." });
        }
      } catch (error) {
        setNotice({
          variant: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setSaving("idle");
      }
    },
    [
      settings,
      tunnelProvider,
      ngrokToken,
      ngrokDomain,
      cfToken,
      cfHostname,
      onServicesRestarted,
    ],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[min(780px,calc(100vw-32px))] max-w-[calc(100vw-32px)] flex-col overflow-hidden p-4 sm:max-w-[min(780px,calc(100vw-32px))]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-primary" />
            {t("Settings")}
          </DialogTitle>
        </DialogHeader>

        {notice && (
          <div className="px-4 pb-2">
            <StatusBanner variant={notice.variant}>
              {t(notice.message)}
            </StatusBanner>
          </div>
        )}

        <Tabs defaultValue="general" className="min-h-0 flex-1">
          <TabsList className="mb-3 shrink-0">
            <TabsTrigger value="general">
              <SettingsIcon className="h-3 w-3" />
              {t("General")}
            </TabsTrigger>
            <TabsTrigger value="im">
              <MessageSquare className="h-3 w-3" />
              {t("IM")}
            </TabsTrigger>
            <TabsTrigger value="tunnel">
              <Globe className="h-3 w-3" />
              {t("Tunnel")}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="general"
            className="min-h-0 overflow-y-auto pr-3 pb-1 [scrollbar-gutter:stable]"
          >
            <div className="space-y-2">
              <SettingsActionRow
                label={t("Restart Services")}
                action={
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving !== "idle"}
                    onClick={() => void restartServices()}
                  >
                    <RotateCw className="h-3 w-3" />
                    {saving === "restart-services"
                      ? t("Restarting services…")
                      : t("Restart")}
                  </Button>
                }
              />
              <SettingsActionRow
                label={t("Rerun Onboarding")}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving !== "idle"}
                    onClick={() => window.location.replace("/onboarding")}
                  >
                    <WandSparkles className="h-3 w-3" />
                    {t("Open Config Wizard")}
                  </Button>
                }
              />
            </div>
          </TabsContent>

          <TabsContent
            value="im"
            className="min-h-0 overflow-y-auto pr-3 pb-1 [scrollbar-gutter:stable]"
          >
            {loading ? (
              <LoadingBlock />
            ) : (
              <div className="space-y-3">
                <StepChannels
                  pluginRegistry={pluginRegistry}
                  discoveredPlugins={discoveredPlugins}
                  enabledChannels={enabledChannels}
                  channelConfigs={channelConfigs}
                  channelVerbose={channelVerbose}
                  installingPlugins={installingPlugins}
                  authStates={authStates}
                  onToggleChannel={toggleChannel}
                  onConfigChange={updateChannelConfig}
                  onVerboseChange={updateChannelVerbose}
                  onInstallPlugin={installPlugin}
                  onStartAuth={(pluginId) => void startAuth(pluginId)}
                  onCancelAuth={(pluginId) => void cancelAuth(pluginId)}
                  switchSize="sm"
                />
                <div className="flex justify-end border-t border-border pt-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canSubmit}
                    onClick={() => void applyImSettings()}
                  >
                    {saving === "im" ? t("Applying…") : t("Apply IM Settings")}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="tunnel"
            className="min-h-0 overflow-y-auto pr-3 pb-1 [scrollbar-gutter:stable]"
          >
            {loading ? (
              <LoadingBlock />
            ) : (
              <div className="space-y-3">
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
                <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canSubmit}
                    onClick={() => void saveTunnelSettings(false)}
                  >
                    {saving === "tunnel" ? t("Saving…") : t("Save")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canSubmit}
                    onClick={() => void saveTunnelSettings(true)}
                  >
                    <RotateCw className="h-3 w-3" />
                    {saving === "tunnel-restart"
                      ? t("Restarting services…")
                      : t("Save & Restart Services")}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SettingsActionRow({
  label,
  action,
}: {
  label: string;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <span className="text-sm font-medium">{label}</span>
      {action}
    </div>
  );
}

function LoadingBlock() {
  const { t } = useI18n();
  return (
    <p className="px-1 py-6 text-center text-xs text-muted-foreground">
      {t("Loading…")}
    </p>
  );
}

function buildChannelSettings({
  settings,
  pluginRegistry,
  discoveredPlugins,
  enabledChannels,
  channelConfigs,
  channelVerbose,
}: {
  settings: AppSettings;
  pluginRegistry: PluginRegistryEntry[];
  discoveredPlugins: DiscoveredChannelPlugin[];
  enabledChannels: Set<string>;
  channelConfigs: Record<string, Record<string, string>>;
  channelVerbose: Record<string, ChannelVerboseConfig>;
}): AppSettings {
  const result: AppSettings = { ...settings };
  const existingChannels = isRecord(settings.channels) ? settings.channels : {};
  const knownPluginIds = new Set([
    ...pluginRegistry.map((plugin) => plugin.id),
    ...discoveredPlugins.map((plugin) => plugin.id),
  ]);
  const discoveredMap = new Map(
    discoveredPlugins.map((plugin) => [plugin.id, plugin]),
  );
  const channels: Record<string, Record<string, unknown>> = {};

  for (const [id, value] of Object.entries(existingChannels)) {
    if (!knownPluginIds.has(id) && isRecord(value)) {
      channels[id] = { ...value };
    }
  }

  for (const id of knownPluginIds) {
    if (!enabledChannels.has(id)) continue;
    const existing = isRecord(existingChannels[id])
      ? existingChannels[id]
      : {};
    const config: Record<string, unknown> = { ...existing };
    const schemaProps = discoveredMap.get(id)?.configSchema?.properties ?? {};
    const editableKeys = new Set([
      ...Object.entries(schemaProps)
        .filter(([, prop]) => !prop.hidden)
        .map(([key]) => key),
      ...Object.keys(channelConfigs[id] ?? {}),
    ]);

    for (const key of editableKeys) {
      if (key === "verbose") continue;
      const value = channelConfigs[id]?.[key] ?? "";
      const prop = schemaProps[key] as ConfigSchemaProperty | undefined;
      if (value || prop?.default) {
        config[key] = value || prop?.default;
      } else {
        delete config[key];
      }
    }

    const verbose = channelVerbose[id] ?? parseChannelVerbose(config.verbose);
    config.verbose = {
      show_thinking: verbose.show_thinking,
      show_tool_use: verbose.show_tool_use,
    };
    channels[id] = config;
  }

  if (Object.keys(channels).length > 0) {
    result.channels = channels;
  } else {
    delete result.channels;
  }

  return result;
}

function buildTunnelSettings({
  settings,
  tunnelProvider,
  ngrokToken,
  ngrokDomain,
  cfToken,
  cfHostname,
}: {
  settings: AppSettings;
  tunnelProvider: TunnelProvider;
  ngrokToken: string;
  ngrokDomain: string;
  cfToken: string;
  cfHostname: string;
}): AppSettings {
  const result: AppSettings = { ...settings };
  if (tunnelProvider === "none") {
    delete result.tunnel;
    return result;
  }

  const tunnel: AppSettings["tunnel"] = { provider: tunnelProvider };
  if (tunnelProvider === "ngrok") {
    tunnel.ngrok = {};
    if (ngrokToken.trim()) tunnel.ngrok.auth_token = ngrokToken.trim();
    if (ngrokDomain.trim()) tunnel.ngrok.domain = ngrokDomain.trim();
  }
  if (tunnelProvider === "cloudflare") {
    tunnel.cloudflare = {};
    if (cfToken.trim()) tunnel.cloudflare.tunnel_token = cfToken.trim();
    if (cfHostname.trim()) tunnel.cloudflare.hostname = cfHostname.trim();
  }
  result.tunnel = tunnel;
  return result;
}

function defaultChannelVerbose(): ChannelVerboseConfig {
  return {
    show_thinking: false,
    show_tool_use: false,
  };
}

function parseChannelVerbose(value: unknown): ChannelVerboseConfig {
  if (!isRecord(value)) return defaultChannelVerbose();
  return {
    show_thinking:
      typeof value.show_thinking === "boolean" ? value.show_thinking : false,
    show_tool_use:
      typeof value.show_tool_use === "boolean" ? value.show_tool_use : false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
