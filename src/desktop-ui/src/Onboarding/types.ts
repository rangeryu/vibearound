import type { AgentId, TunnelProvider } from "./constants";

export interface Settings {
  onboarded?: boolean;
  working_dir?: string;
  default_agent?: string;
  enabled_agents?: string[];
  tunnel?: {
    provider?: string;
    ngrok?: { auth_token?: string; domain?: string };
    cloudflare?: { tunnel_token?: string; hostname?: string };
  };
  channels?: Record<
    string,
    {
      bot_token?: string;
      app_id?: string;
      app_secret?: string;
      base_url?: string;
      account_id?: string;
      verbose?: { show_thinking?: boolean; show_tool_use?: boolean };
      [key: string]: unknown;
    }
  >;
  [key: string]: unknown;
}

export interface PluginAuthCapabilities {
  methods: string[];
}

export interface PluginCapabilities {
  streaming: boolean;
  interactiveCards: boolean;
  reactions: boolean;
  editMessage: boolean;
  media: boolean;
  auth?: PluginAuthCapabilities;
}

export interface DiscoveredChannelPlugin {
  id: string;
  name: string;
  version: string;
  kind: string;
  runtime: string;
  entry: string;
  source: "user" | "project";
  supportsQrcodeLogin: boolean;
  configSchema?: unknown;
  capabilities: PluginCapabilities;
}

export interface WechatQrStartResponse {
  qrcodeUrl?: string;
  message: string;
  sessionKey: string;
}

export interface WechatQrWaitResponse {
  connected: boolean;
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
  message: string;
}

export type WechatQrStatus =
  | "idle"
  | "generating"
  | "waiting"
  | "connected"
  | "error";

export interface StepAgentsProps {
  enabled: Set<AgentId>;
  defaultAgent: AgentId;
  onToggle: (id: AgentId) => void;
  onSetDefault: (id: AgentId) => void;
}

export interface StepChannelsProps {
  discoveredPlugins: DiscoveredChannelPlugin[];
  telegramEnabled: boolean;
  onTelegramEnabledChange: (enabled: boolean) => void;
  tgToken: string;
  onTgToken: (value: string) => void;
  feishuEnabled: boolean;
  onFeishuEnabledChange: (enabled: boolean) => void;
  feishuAppId: string;
  onFeishuAppId: (value: string) => void;
  feishuAppSecret: string;
  onFeishuAppSecret: (value: string) => void;
  wechatEnabled: boolean;
  onWechatEnabledChange: (enabled: boolean) => void;
  wechatBaseUrl: string;
  onWechatBaseUrl: (value: string) => void;
  wechatQrStatus: WechatQrStatus;
  wechatQrCodeUrl: string;
  wechatQrMessage: string;
  wechatAccountId: string;
  wechatBotToken: string;
  wechatQrSessionKey: string;
  onStartWechatQrLogin: () => void;
  onCancelWechatQrLogin: () => void;
}

export interface StepTunnelProps {
  provider: TunnelProvider;
  onProvider: (value: TunnelProvider) => void;
  ngrokToken: string;
  onNgrokToken: (value: string) => void;
  ngrokDomain: string;
  onNgrokDomain: (value: string) => void;
  cfToken: string;
  onCfToken: (value: string) => void;
  cfHostname: string;
  onCfHostname: (value: string) => void;
}

export interface StepConfirmProps {
  enabledAgents: Set<AgentId>;
  defaultAgent: AgentId;
  tunnelProvider: TunnelProvider;
  hasTelegram: boolean;
  hasFeishu: boolean;
  hasWechat: boolean;
}
