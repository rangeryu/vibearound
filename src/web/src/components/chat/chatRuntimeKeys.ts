import type { LaunchSessionInfo } from "@va/client";
import { chatSessionKey } from "./chatSessionModel";

const DRAFT_RUNTIME_PREFIX = "draft";
const SESSION_RUNTIME_PREFIX = "session";
const RANDOM_ID_RADIX = 36;

export const INITIAL_RUNTIME_KEY = `${DRAFT_RUNTIME_PREFIX}:initial`;

export function createDraftRuntimeKey(agentId: string) {
  return [
    DRAFT_RUNTIME_PREFIX,
    agentId,
    Date.now(),
    Math.random().toString(RANDOM_ID_RADIX).slice(2),
  ].join(":");
}

export function chatRuntimeKeyForSession(
  session: Pick<LaunchSessionInfo, "agent_id" | "workspace" | "session_id">,
) {
  return `${SESSION_RUNTIME_PREFIX}:${chatSessionKey(session)}`;
}
