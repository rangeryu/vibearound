const MESSAGE_KEYS = ["message", "error", "detail", "reason", "description"] as const;
const DETAIL_KEYS = ["code", "status", "statusCode", "type"] as const;

export function formatErrorMessage(error: unknown, fallback = "Unknown error"): string {
  const formatted = formatErrorValue(error, new Set());
  return formatted || fallback;
}

function formatErrorValue(error: unknown, seen: Set<unknown>): string | undefined {
  if (typeof error === "string") return clean(error);
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  if (error == null) return undefined;

  if (error instanceof Error) {
    return clean(error.message) || clean(error.name);
  }

  if (typeof error !== "object") {
    return clean(String(error));
  }

  if (seen.has(error)) return undefined;
  seen.add(error);

  const record = error as Record<string, unknown>;
  const message = MESSAGE_KEYS
    .map((key) => formatErrorValue(record[key], seen))
    .find(Boolean);
  const details = DETAIL_KEYS
    .map((key) => {
      const value = primitiveDetail(record[key]);
      return value ? `${key}: ${value}` : null;
    })
    .filter((value): value is string => Boolean(value));

  if (message && details.length > 0) {
    return `${message} (${details.join(", ")})`;
  }
  if (message) return message;

  try {
    return clean(JSON.stringify(error));
  } catch {
    return undefined;
  }
}

function primitiveDetail(value: unknown): string | undefined {
  if (typeof value === "string") return clean(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "[object Object]") return undefined;
  return trimmed;
}
