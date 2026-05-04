import type {
  ConnectionAgentId,
  ProfileConnectionPreference,
  ProfileConnections,
  ProfileSummary,
} from "./types";
import { apiTypeBadge } from "./types";

export interface ConnectionAgentDef {
  id: ConnectionAgentId;
  label: string;
  requiredApiType: string;
  requiredProtocol: string;
  clientProtocol: string;
}

export interface ResolvedProfileConnection {
  agent: ConnectionAgentDef;
  native: boolean;
  proxyEnabled: boolean;
  targetApiType: string | null;
  targetOptions: string[];
  status: "native" | "via_proxy" | "unsupported";
}

export const CONNECTION_AGENTS: ConnectionAgentDef[] = [
  {
    id: "claude",
    label: "Claude Code",
    requiredApiType: "anthropic",
    requiredProtocol: "Anthropic Messages",
    clientProtocol: "Claude Messages",
  },
  {
    id: "codex",
    label: "Codex CLI",
    requiredApiType: "openai-responses",
    requiredProtocol: "OpenAI Responses",
    clientProtocol: "Codex Responses",
  },
];

const PROXY_TARGET_API_TYPES = ["anthropic", "openai-responses", "openai-chat"];

export function resolveProfileConnection(
  profile: ProfileSummary,
  connections: ProfileConnections | undefined,
  agent: ConnectionAgentDef,
): ResolvedProfileConnection {
  const preference = connections?.[profile.id]?.[agent.id];
  const targetOptions = proxyTargetApiTypes(profile);
  const native = profile.apiTypes.includes(agent.requiredApiType);
  const preferredTarget =
    preference?.targetApiType && targetOptions.includes(preference.targetApiType)
      ? preference.targetApiType
      : recommendedProxyTarget(profile, agent.id);
  const proxyEnabled = Boolean(preference?.proxyEnabled && preferredTarget);
  const status = proxyEnabled ? "via_proxy" : native ? "native" : "unsupported";

  return {
    agent,
    native,
    proxyEnabled,
    targetApiType: preferredTarget,
    targetOptions,
    status,
  };
}

export function emptyConnectionDraft(
  profile: ProfileSummary,
  connections: ProfileConnections | undefined,
): Record<ConnectionAgentId, ProfileConnectionPreference> {
  return Object.fromEntries(
    CONNECTION_AGENTS.map((agent) => {
      const resolved = resolveProfileConnection(profile, connections, agent);
      return [
        agent.id,
        {
          proxyEnabled: resolved.proxyEnabled,
          targetApiType: resolved.targetApiType,
        },
      ];
    }),
  ) as Record<ConnectionAgentId, ProfileConnectionPreference>;
}

export function proxyTargetApiTypes(profile: ProfileSummary): string[] {
  return profile.apiTypes.filter((apiType) => PROXY_TARGET_API_TYPES.includes(apiType));
}

export function recommendedProxyTarget(
  profile: ProfileSummary,
  agentId: ConnectionAgentId,
): string | null {
  const order =
    agentId === "codex"
      ? ["anthropic", "openai-chat", "openai-responses"]
      : ["openai-responses", "openai-chat", "anthropic"];
  return order.find((apiType) => profile.apiTypes.includes(apiType)) ?? null;
}

export function apiTypeProtocolLabel(apiType: string): string {
  switch (apiType) {
    case "anthropic":
      return "Anthropic Messages";
    case "openai-responses":
      return "OpenAI Responses";
    case "openai-chat":
      return "OpenAI Chat Completions";
    default:
      return apiType;
  }
}

export function apiTypeRouteLabel(apiType: string): string {
  switch (apiType) {
    case "anthropic":
      return "Anthropic";
    case "openai-responses":
      return "Responses";
    case "openai-chat":
      return "Chat";
    default:
      return apiTypeBadge(apiType);
  }
}
