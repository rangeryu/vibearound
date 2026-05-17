import type { ChatActivity } from "./chatTypes";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringField(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function switchedAgentId(text: string) {
  const match = /^Switched to ([A-Za-z0-9_-]+)\.$/.exec(text.trim());
  return match?.[1];
}

export function lastActivity(activities: ChatActivity[] | undefined) {
  return activities?.[activities.length - 1];
}

export function toolActivityId(update: unknown) {
  const record = asRecord(update);
  return (
    stringField(record, "toolCallId") ??
    stringField(record, "tool_call_id") ??
    stringField(record, "id")
  );
}

export function toolActivityLabel(update: unknown) {
  const record = asRecord(update);
  const toolCall = asRecord(record?.toolCall);
  return (
    stringField(record, "title") ??
    stringField(toolCall, "title") ??
    stringField(record, "kind") ??
    stringField(toolCall, "kind") ??
    "tool"
  );
}

export function toolActivityStatus(update: unknown) {
  const record = asRecord(update);
  return stringField(record, "status");
}

export function findLastMatchingActivity(
  activities: ChatActivity[],
  predicate: (activity: ChatActivity) => boolean,
) {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    if (predicate(activities[index])) return index;
  }
  return -1;
}

export function createMessageId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
