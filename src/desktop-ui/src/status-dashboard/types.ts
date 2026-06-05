import type { useI18n } from "@va/i18n";

import type { AgentRuntime } from "../hooks/useAgentsRuntime";
import type { ChannelRuntime } from "../hooks/useChannelsState";
import type { TunnelRuntime } from "../hooks/useTunnelsState";

export type Translate = ReturnType<typeof useI18n>["t"];
export type Tone = "good" | "busy" | "warning" | "danger" | "muted";

export interface StatusDashboardProps {
  channels: {
    channels: ChannelRuntime[];
    connected: boolean;
    loading: boolean;
    refresh: () => unknown;
    start: (kind: string) => unknown;
    stop: (kind: string) => unknown;
    restart: (kind: string) => unknown;
  };
  tunnels: {
    tunnels: TunnelRuntime[];
    connected: boolean;
    loading: boolean;
    refresh: () => unknown;
    kill: (provider: string) => unknown;
  };
  agents: {
    agents: AgentRuntime[];
    connected: boolean;
    loading: boolean;
    refresh: () => unknown;
    kill: (routeKey: string) => unknown;
  };
  onRefresh: () => void;
}
