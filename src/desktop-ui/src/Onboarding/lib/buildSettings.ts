import type {
  ChannelVerboseConfig,
  DiscoveredChannelPlugin,
  Settings,
} from "../types";
import type { AgentId, TunnelProvider } from "../constants";

export interface BuildSettingsInput {
  settings: Settings;
  configureAgents?: boolean;
  configureChannels?: boolean;
  configureTunnel?: boolean;
  enabledAgents: Set<AgentId>;
  enabledChannels: Set<string>;
  registryPluginIds?: Set<string>;
  channelConfigs: Record<string, Record<string, string>>;
  channelVerbose?: Record<string, ChannelVerboseConfig>;
  discoveredPlugins: DiscoveredChannelPlugin[];
  tunnelProvider: TunnelProvider;
  ngrokToken: string;
  ngrokDomain: string;
  cfToken: string;
  cfHostname: string;
}

/**
 * Reduce the UI state into the final `settings.json` payload that
 * the daemon reads. Pure — no Tauri calls, no React — so it stays
 * testable in isolation.
 */
export function buildSettings(input: BuildSettingsInput): Settings {
  const {
    settings,
    configureAgents = true,
    configureChannels = true,
    configureTunnel = true,
    enabledAgents,
    enabledChannels,
    registryPluginIds = new Set(enabledChannels),
    channelConfigs,
    channelVerbose = {},
    discoveredPlugins,
    tunnelProvider,
    ngrokToken,
    ngrokDomain,
    cfToken,
    cfHostname,
  } = input;

  const result: Settings = {
    ...settings,
  };
  if (configureAgents) {
    result.enabled_agents = Array.from(enabledAgents);
    delete result.default_workspace;
    delete result.default_agent;
    delete result.default_profiles;
  }

  if (configureChannels) {
    const existingChannels = isRecord(settings.channels)
      ? settings.channels
      : {};
    const channels: Record<string, Record<string, unknown>> = {};

    // Preserve internal/custom channel config (for example web/ws verbose flags)
    // while rebuilding the registry-backed plugin selection from the UI.
    for (const [id, existingConfig] of Object.entries(existingChannels)) {
      if (registryPluginIds.has(id)) continue;
      if (isRecord(existingConfig)) {
        channels[id] = { ...existingConfig };
      }
    }

    for (const id of enabledChannels) {
      if (!registryPluginIds.has(id)) continue;

      const config: Record<string, unknown> = {};
      const userConfig = channelConfigs[id] ?? {};

      for (const [key, value] of Object.entries(userConfig)) {
        if (value) config[key] = value;
      }

      const discovered = discoveredPlugins.find((p) => p.id === id);
      if (discovered?.configSchema?.properties) {
        for (const [key, prop] of Object.entries(
          discovered.configSchema.properties,
        )) {
          if (prop.hidden && prop.default && !config[key]) {
            config[key] = prop.default;
          }
        }
      }

      const existingVerbose = isRecord(existingChannels[id])
        ? parseVerbose(existingChannels[id].verbose)
        : undefined;
      const verbose = channelVerbose[id] ?? existingVerbose ?? defaultVerbose();
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
  }

  if (configureTunnel) {
    if (tunnelProvider !== "none") {
      const tunnel: Settings["tunnel"] = { provider: tunnelProvider };
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
    } else {
      delete result.tunnel;
    }
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultVerbose(): ChannelVerboseConfig {
  return {
    show_thinking: false,
    show_tool_use: false,
  };
}

function parseVerbose(value: unknown): ChannelVerboseConfig | undefined {
  if (!isRecord(value)) return undefined;
  return {
    show_thinking:
      typeof value.show_thinking === "boolean" ? value.show_thinking : false,
    show_tool_use:
      typeof value.show_tool_use === "boolean" ? value.show_tool_use : false,
  };
}
