import type {
  ConnectionAgentId,
  ProfileConnectionPreference,
  ProfileConnections,
  ProfileProxyPreference,
  ProfileSummary,
} from "./types";
import { apiTypeBadge } from "./types";

export interface ConnectionAgentDef {
  id: ConnectionAgentId;
  label: string;
  supportedApiTypes: string[];
  defaultApiType: string;
}

export interface ResolvedClientApiConnection {
  apiType: string;
  native: boolean;
  proxyEnabled: boolean;
  targetApiType: string | null;
  upstreamModel: string | null;
  fakeModelId: string | null;
  agentModel: string | null;
  targetOptions: string[];
  status: "native" | "via_proxy" | "unsupported";
}

export interface ResolvedProfileConnection {
  agent: ConnectionAgentDef;
  selectedApiType: string;
  selected: ResolvedClientApiConnection;
  clientApiTypes: ResolvedClientApiConnection[];
  targetOptions: string[];
  status: "native" | "via_proxy" | "unsupported";
}

export const CONNECTION_AGENTS: ConnectionAgentDef[] = [
  {
    id: "claude",
    label: "Claude Code",
    supportedApiTypes: ["anthropic"],
    defaultApiType: "anthropic",
  },
  {
    id: "codex",
    label: "Codex CLI",
    supportedApiTypes: ["openai-responses"],
    defaultApiType: "openai-responses",
  },
  {
    id: "opencode",
    label: "OpenCode",
    supportedApiTypes: ["openai-responses", "openai-chat", "anthropic"],
    defaultApiType: "openai-responses",
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
  const selectedApiType = selectedClientApiType(profile, agent, preference);
  const clientApiTypes = agent.supportedApiTypes.map((apiType) =>
    resolveClientApiConnection(profile, agent, preference, apiType, targetOptions),
  );
  const selected =
    clientApiTypes.find((item) => item.apiType === selectedApiType) ?? clientApiTypes[0];
  const status = selected?.status ?? "unsupported";

  return {
    agent,
    selectedApiType: selected?.apiType ?? selectedApiType,
    selected,
    clientApiTypes,
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
      const proxy: Record<string, ProfileProxyPreference> = {};
      for (const item of resolved.clientApiTypes) {
        const current = connections?.[profile.id]?.[agent.id]?.proxy?.[item.apiType];
        proxy[item.apiType] = {
          enabled: item.proxyEnabled,
          targetApiType:
            current?.targetApiType && item.targetOptions.includes(current.targetApiType)
              ? current.targetApiType
              : item.targetApiType,
          upstreamModel: current?.upstreamModel ?? item.upstreamModel,
          fakeModelId: current?.fakeModelId ?? item.fakeModelId,
        };
      }
      return [
        agent.id,
        {
          selectedApiType: resolved.selectedApiType,
          proxy,
        },
      ];
    }),
  ) as Record<ConnectionAgentId, ProfileConnectionPreference>;
}

export function proxyTargetApiTypes(profile: ProfileSummary): string[] {
  return profile.apiTypes.filter((apiType) => PROXY_TARGET_API_TYPES.includes(apiType));
}

export function recommendedClientApiType(
  profile: ProfileSummary,
  agent: ConnectionAgentDef,
): string {
  return (
    agent.supportedApiTypes.find((apiType) => profile.apiTypes.includes(apiType)) ??
    agent.defaultApiType
  );
}

export function recommendedProxyTarget(
  profile: ProfileSummary,
  agentId: ConnectionAgentId,
  clientApiType: string,
): string | null {
  const order =
    (agentId === "claude" && clientApiType === "anthropic") ||
    (agentId === "opencode" && clientApiType === "anthropic")
      ? ["openai-responses", "openai-chat", "anthropic"]
      : ["anthropic", "openai-chat", "openai-responses"];
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

function resolveClientApiConnection(
  profile: ProfileSummary,
  agent: ConnectionAgentDef,
  preference: ProfileConnectionPreference | undefined,
  apiType: string,
  targetOptions: string[],
): ResolvedClientApiConnection {
  const proxyPreference = preference?.proxy?.[apiType];
  const targetApiType =
    proxyPreference?.targetApiType && targetOptions.includes(proxyPreference.targetApiType)
      ? proxyPreference.targetApiType
      : recommendedProxyTarget(profile, agent.id, apiType);
  const native = profile.apiTypes.includes(apiType);
  const proxyEnabled = Boolean(proxyPreference?.enabled && targetApiType);
  const status = proxyEnabled ? "via_proxy" : native ? "native" : "unsupported";
  const upstreamModel =
    cleanModelId(proxyPreference?.upstreamModel) ??
    (targetApiType ? cleanModelId(profile.apiTypeModels[targetApiType]) : null);
  const fakeModelId = cleanModelId(proxyPreference?.fakeModelId);

  return {
    apiType,
    native,
    proxyEnabled,
    targetApiType,
    upstreamModel,
    fakeModelId,
    agentModel: fakeModelId ?? upstreamModel,
    targetOptions,
    status,
  };
}

function cleanModelId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function selectedClientApiType(
  profile: ProfileSummary,
  agent: ConnectionAgentDef,
  preference: ProfileConnectionPreference | undefined,
): string {
  const selected = preference?.selectedApiType;
  if (!selected || !agent.supportedApiTypes.includes(selected)) {
    return recommendedClientApiType(profile, agent);
  }
  if (profile.apiTypes.includes(selected)) {
    return selected;
  }
  const proxyPreference = preference?.proxy?.[selected];
  const proxyTarget = proxyPreference?.targetApiType;
  if (
    proxyPreference?.enabled &&
    proxyTarget &&
    proxyTargetApiTypes(profile).includes(proxyTarget)
  ) {
    return selected;
  }
  return recommendedClientApiType(profile, agent);
}
