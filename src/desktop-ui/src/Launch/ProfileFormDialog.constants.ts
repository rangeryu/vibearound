import type { CatalogEntry } from "./types";

export const PROVIDER_TILE_GRID =
  "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2";

/**
 * Synthetic catalog entry for the custom escape hatch. The backend has a
 * matching `catalog::get("custom")` that returns the same shape with the
 * actual render templates; this client-side copy is only used to drive
 * the form (fields list, empty models, empty default base_url).
 */
export const CUSTOM_PROVIDER: CatalogEntry = {
  id: "custom",
  label: "Custom endpoint",
  icon: "✨",
  homepage: null,
  endpoints: [
    {
      api_type: "anthropic",
      default_base_url: "",
      models: [],
      auth_modes: [
        {
          mode: "api_key",
          label: "Use API key",
          fields: [
            {
              name: "api_key",
              label: "API key",
              secret: true,
              required: true,
            },
          ],
        },
      ],
    },
    {
      api_type: "openai-responses",
      default_base_url: "",
      models: [],
      capabilities: {
        reasoning_effort: true,
      },
      auth_modes: [
        {
          mode: "api_key",
          label: "Use API key",
          fields: [
            {
              name: "api_key",
              label: "API key",
              secret: true,
              required: true,
            },
          ],
        },
      ],
    },
    {
      api_type: "openai-chat",
      default_base_url: "",
      models: [],
      auth_modes: [
        {
          mode: "api_key",
          label: "Use API key",
          fields: [
            {
              name: "api_key",
              label: "API key",
              secret: true,
              required: true,
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Generate a fresh profile id. Format: `${provider}-${shortUuid}` so the
 * same provider can host multiple profiles and the on-disk filename still
 * reflects the provider for at-a-glance inspection.
 */
export function generateProfileId(
  providerId: string,
  existingProfileIds: Iterable<string> = [],
): string {
  const existing = new Set(existingProfileIds);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = `${providerId}-${shortUuid()}`;
    if (!existing.has(id)) return id;
  }

  const id = `${providerId}-${uuidHex()}`;
  return existing.has(id) ? `${providerId}-${Date.now().toString(36)}-${shortUuid()}` : id;
}

function shortUuid(): string {
  return uuidHex().slice(0, 12);
}

function uuidHex(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  }

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byteToHex).join("");
  }

  // Non-browser fallback for unusual test runners.
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}

function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

export const INPUT_CLASS = "h-8 text-[13px]";
export const MONO_INPUT_CLASS = "h-8 text-[13px] font-mono";
export const SECRET_INPUT_CLASS = "h-8 pr-8 text-[13px] font-mono";
