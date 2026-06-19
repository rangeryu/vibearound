export type LocalApiProtocol = "openai-responses" | "openai-chat" | "anthropic";

export interface LocalAgentApiTarget {
  agentId: string;
  agentLabel: string;
  profileId: string;
  profileLabel: string;
  workspacePath: string;
}

export interface LocalApiProtocolSpec {
  id: LocalApiProtocol;
  label: string;
  shortLabel: string;
  endpoint: string;
}

export interface LocalAgentModel {
  id: string;
  displayName: string;
  description: string;
}

export const LOCAL_API_PROTOCOLS: LocalApiProtocolSpec[] = [
  {
    id: "openai-responses",
    label: "OpenAI Responses",
    shortLabel: "Responses",
    endpoint: "responses",
  },
  {
    id: "openai-chat",
    label: "OpenAI Chat Completions",
    shortLabel: "Chat",
    endpoint: "chat/completions",
  },
  {
    id: "anthropic",
    label: "Anthropic Messages",
    shortLabel: "Anthropic",
    endpoint: "messages",
  },
];

export function localAgentBasePath(target: LocalAgentApiTarget): string {
  return `/local-agent/${encodeURIComponent(target.agentId)}/${encodeURIComponent(
    target.profileId,
  )}/v1`;
}

export function localAgentProtocolSpec(
  protocol: LocalApiProtocol,
): LocalApiProtocolSpec {
  return (
    LOCAL_API_PROTOCOLS.find((item) => item.id === protocol) ??
    LOCAL_API_PROTOCOLS[0]
  );
}

export function localAgentTestPayload(
  protocol: LocalApiProtocol,
  model: string,
  prompt: string,
) {
  switch (protocol) {
    case "openai-chat":
      return {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      };
    case "anthropic":
      return {
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      };
    case "openai-responses":
    default:
      return { model, input: prompt, stream: false };
  }
}

export function extractLocalAgentModels(payload: unknown): LocalAgentModel[] {
  const seen = new Set<string>();
  const models: LocalAgentModel[] = [];
  for (const item of asArray(asRecord(payload).data)) {
    const record = asRecord(item);
    const id = stringValue(record.id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const displayName = stringValue(record.display_name).trim() || id;
    models.push({
      id,
      displayName,
      description: stringValue(record.description).trim() || displayName,
    });
  }
  return models;
}

export function extractLocalAgentModelIds(payload: unknown): string[] {
  return extractLocalAgentModels(payload).map((model) => model.id);
}

export function formatLocalAgentModelLabel(model: LocalAgentModel): string {
  return model.id;
}

export function parseLocalAgentJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractLocalAgentResponseText(
  protocol: LocalApiProtocol,
  payload: unknown,
): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (protocol === "openai-chat") {
    const choice = asArray(record.choices)[0];
    const message = asRecord(asRecord(choice).message);
    return stringValue(message.content);
  }
  if (protocol === "anthropic") {
    return asArray(record.content)
      .map((part) => stringValue(asRecord(part).text))
      .filter(Boolean)
      .join("");
  }
  const outputText = stringValue(record.output_text);
  if (outputText) return outputText;
  return asArray(record.output)
    .flatMap((item) => asArray(asRecord(item).content))
    .map((part) => stringValue(asRecord(part).text))
    .filter(Boolean)
    .join("");
}

export function localAgentErrorText(payload: unknown, fallback: string): string {
  const error = asRecord(asRecord(payload).error);
  return stringValue(error.message) || fallback;
}

export function maskLocalApiAuthHeader(value: string): string {
  const prefix = "Authorization: Bearer ";
  if (!value.startsWith(prefix)) return value;
  const token = value.slice(prefix.length);
  if (!token || token === "<token>") return value;
  if (token.length <= 18) return `${prefix}${token}`;
  return `${prefix}${token.slice(0, 8)}...${token.slice(-6)}`;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
