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
}

export interface LocalAgentTestAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
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
  attachments: readonly LocalAgentTestAttachment[] = [],
) {
  if (attachments.length > 0) {
    return localAgentMultimodalTestPayload(protocol, model, prompt, attachments);
  }

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

function localAgentMultimodalTestPayload(
  protocol: LocalApiProtocol,
  model: string,
  prompt: string,
  attachments: readonly LocalAgentTestAttachment[],
) {
  switch (protocol) {
    case "openai-chat":
      return {
        model,
        messages: [
          {
            role: "user",
            content: [
              ...openAiChatTextBlocks(prompt),
              ...attachments.map(openAiChatAttachmentBlock),
            ],
          },
        ],
        stream: false,
      };
    case "anthropic":
      return {
        model,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              ...anthropicTextBlocks(prompt),
              ...attachments.map(anthropicAttachmentBlock),
            ],
          },
        ],
        stream: false,
      };
    case "openai-responses":
    default:
      return {
        model,
        input: [
          {
            role: "user",
            content: [
              ...openAiResponsesTextBlocks(prompt),
              ...attachments.map(openAiResponsesAttachmentBlock),
            ],
          },
        ],
        stream: false,
      };
  }
}

function openAiResponsesTextBlocks(prompt: string): unknown[] {
  return prompt.trim() ? [{ type: "input_text", text: prompt }] : [];
}

function openAiChatTextBlocks(prompt: string): unknown[] {
  return prompt.trim() ? [{ type: "text", text: prompt }] : [];
}

function anthropicTextBlocks(prompt: string): unknown[] {
  return prompt.trim() ? [{ type: "text", text: prompt }] : [];
}

function openAiResponsesAttachmentBlock(attachment: LocalAgentTestAttachment) {
  if (isImageMime(attachment.mimeType)) {
    return {
      type: "input_image",
      image_url: attachment.dataUrl,
    };
  }
  return {
    type: "input_file",
    filename: attachment.name,
    file_data: attachment.dataUrl,
  };
}

function openAiChatAttachmentBlock(attachment: LocalAgentTestAttachment) {
  if (isImageMime(attachment.mimeType)) {
    return {
      type: "image_url",
      image_url: {
        url: attachment.dataUrl,
      },
    };
  }
  return {
    type: "input_file",
    filename: attachment.name,
    file_data: attachment.dataUrl,
    media_type: attachment.mimeType || "application/octet-stream",
  };
}

function anthropicAttachmentBlock(attachment: LocalAgentTestAttachment) {
  const source = anthropicBase64Source(attachment);
  if (isImageMime(attachment.mimeType)) {
    return {
      type: "image",
      source,
    };
  }
  return {
    type: "document",
    title: attachment.name,
    source,
  };
}

function anthropicBase64Source(attachment: LocalAgentTestAttachment) {
  const parsed = splitBase64DataUrl(attachment.dataUrl);
  return {
    type: "base64",
    media_type:
      parsed?.mimeType || attachment.mimeType || "application/octet-stream",
    data: parsed?.data || attachment.dataUrl,
  };
}

function splitBase64DataUrl(
  dataUrl: string,
): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/i.exec(dataUrl);
  if (!match) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    data: match[2] || "",
  };
}

function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

export function extractLocalAgentModels(payload: unknown): LocalAgentModel[] {
  const seen = new Set<string>();
  const models: LocalAgentModel[] = [];
  for (const item of asArray(asRecord(payload).data)) {
    const record = asRecord(item);
    const id = stringValue(record.id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id });
  }
  return models;
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
