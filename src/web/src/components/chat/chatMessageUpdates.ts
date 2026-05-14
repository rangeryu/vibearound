import type { ChatActivity, ChatMessage } from "./chatTypes";
import {
  findLastMatchingActivity,
  lastActivity,
  toolActivityId,
  toolActivityLabel,
  toolActivityStatus,
} from "./chatFrameUtils";

export function appendStandaloneAssistantMessage(
  prev: ChatMessage[],
  text: string,
): ChatMessage[] {
  if (!text) return prev;
  const next = [...prev];
  const last = next[next.length - 1];
  if (
    last?.role === "assistant" &&
    last.mode === "stream" &&
    last.content === "" &&
    !last.progress &&
    !last.activities?.length
  ) {
    next.pop();
  }
  next.push({ role: "assistant", content: text, mode: "standalone" });
  return next;
}

export function appendStreamAssistantMessage(prev: ChatMessage[], text: string): ChatMessage[] {
  if (!text) return prev;
  if (prev.length === 0) return [{ role: "assistant", content: text, mode: "stream" }];
  const last = prev[prev.length - 1];
  if (last.role !== "assistant" || last.mode !== "stream") {
    return [...prev, { role: "assistant", content: text, mode: "stream" }];
  }
  const next = [...prev];
  next[next.length - 1] = {
    ...last,
    content: last.content + text,
    progress: undefined,
    mode: "stream",
  };
  return next;
}

function updateStreamAssistantMessage(
  prev: ChatMessage[],
  updater: (message: ChatMessage) => ChatMessage,
  fallback: ChatMessage,
): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (!last || last.role !== "assistant" || last.mode !== "stream") {
    return [...prev, fallback];
  }
  const next = [...prev];
  next[next.length - 1] = updater(last);
  return next;
}

export function appendThinkingActivityMessage(
  prev: ChatMessage[],
  text: string,
  thinkingLabel: string,
): ChatMessage[] {
  if (!text) return prev;
  return updateStreamAssistantMessage(
    prev,
    (message) => {
      const activities = [...(message.activities ?? [])];
      const last = lastActivity(activities);
      if (last?.kind === "thinking" && last.active !== false) {
        activities[activities.length - 1] = {
          ...last,
          detail: `${last.detail ?? ""}${text}`,
          active: true,
        };
      } else {
        activities.push({
          id: `thinking-${Date.now()}-${activities.length}`,
          kind: "thinking",
          label: thinkingLabel,
          detail: text,
          active: true,
        });
      }
      return { ...message, activities, progress: text, mode: "stream" };
    },
    {
      role: "assistant",
      content: "",
      progress: text,
      activities: [
        {
          id: `thinking-${Date.now()}-0`,
          kind: "thinking",
          label: thinkingLabel,
          detail: text,
          active: true,
        },
      ],
      mode: "stream",
    },
  );
}

export function appendToolActivityMessage(prev: ChatMessage[], update: unknown): ChatMessage[] {
  const label = toolActivityLabel(update);
  const status = toolActivityStatus(update);
  const id = toolActivityId(update);
  const active = status !== "completed" && status !== "failed";
  return updateStreamAssistantMessage(
    prev,
    (message) => {
      const activities = [...(message.activities ?? [])];
      const existingIndex =
        id !== undefined
          ? activities.findIndex((activity) => activity.id === id)
          : findLastMatchingActivity(
              activities,
              (activity) =>
                activity.kind === "tool" &&
                activity.label === label &&
                activity.active !== false,
            );
      const activity: ChatActivity = {
        id: id ?? `tool-${Date.now()}-${activities.length}`,
        kind: "tool",
        label,
        status,
        active,
      };
      if (existingIndex >= 0) {
        activities[existingIndex] = {
          ...activities[existingIndex],
          ...activity,
          id: activities[existingIndex].id,
        };
      } else {
        activities.push(activity);
      }
      return { ...message, activities, mode: "stream" };
    },
    {
      role: "assistant",
      content: "",
      activities: [
        {
          id: id ?? `tool-${Date.now()}-0`,
          kind: "tool",
          label,
          status,
          active,
        },
      ],
      mode: "stream",
    },
  );
}

export function setStreamProgressMessage(
  prev: ChatMessage[],
  progress: string,
): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (!last || last.role !== "assistant" || last.mode !== "stream") {
    return [...prev, { role: "assistant", content: "", progress, mode: "stream" }];
  }
  const next = [...prev];
  next[next.length - 1] = { ...last, progress, mode: "stream" };
  return next;
}

export function clearStreamProgressMessage(prev: ChatMessage[]): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (!last || last.role !== "assistant" || last.mode !== "stream" || !last.progress) {
    return prev;
  }
  const next = [...prev];
  next[next.length - 1] = { ...last, progress: undefined, mode: "stream" };
  return next;
}

export function appendErrorToStreamMessage(
  prev: ChatMessage[],
  errorMessage: string,
): ChatMessage[] {
  const last = prev[prev.length - 1];
  if (!last || last.role !== "assistant" || last.mode !== "stream") {
    return [...prev, { role: "assistant", content: errorMessage, mode: "stream" }];
  }
  const next = [...prev];
  next[next.length - 1] = {
    ...last,
    content: last.content + (last.content ? "\n\n" : "") + errorMessage,
    progress: undefined,
    mode: "stream",
  };
  return next;
}
