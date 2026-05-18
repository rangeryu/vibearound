import type { ChatSessionWorkspaceGroup } from "./chatSessionModel";
import { normalizeSessionGroups } from "./chatSessionModel";
import type { WorkspaceItem } from "@va/client";

const LAUNCH_SELECTION_STORAGE_KEY = "vibearound.webChat.launchSelection";
const ACTIVE_LAUNCH_SESSION_STORAGE_KEY = "vibearound.webChat.activeLaunchSession";
const LAUNCH_SESSION_CACHE_STORAGE_KEY = "vibearound.webChat.launchSessions.v1";
const SESSION_SIDEBAR_WIDTH_STORAGE_KEY = "vibearound.webChat.sessionSidebarWidth";

export const SESSION_SIDEBAR_DEFAULT_WIDTH = 256;
export const SESSION_SIDEBAR_MIN_WIDTH = 224;
export const SESSION_SIDEBAR_MAX_WIDTH = 420;

export interface StoredLaunchSelection {
  agentId?: string;
  profileId?: string;
}

export interface StoredActiveLaunchSession {
  agentId: string;
  sessionId: string;
  workspace: string;
}

interface StoredLaunchSessionCache {
  scope: string;
  syncedAt: number;
  groups: ChatSessionWorkspaceGroup[];
}

export function readStoredLaunchSelection(): StoredLaunchSelection {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LAUNCH_SELECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredLaunchSelection;
    return {
      agentId: typeof parsed.agentId === "string" ? parsed.agentId : undefined,
      profileId: typeof parsed.profileId === "string" ? parsed.profileId : undefined,
    };
  } catch {
    return {};
  }
}

export function writeStoredLaunchSelection(
  selection: Required<StoredLaunchSelection>,
) {
  try {
    window.localStorage.setItem(
      LAUNCH_SELECTION_STORAGE_KEY,
      JSON.stringify(selection),
    );
  } catch {
    // Ignore storage failures; the picker still works for this session.
  }
}

export function readStoredActiveLaunchSession():
  | StoredActiveLaunchSession
  | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(ACTIVE_LAUNCH_SESSION_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredActiveLaunchSession>;
    if (
      typeof parsed.agentId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.workspace !== "string"
    ) {
      return undefined;
    }
    return {
      agentId: parsed.agentId,
      sessionId: parsed.sessionId,
      workspace: parsed.workspace,
    };
  } catch {
    return undefined;
  }
}

export function writeStoredActiveLaunchSession(
  session: StoredActiveLaunchSession,
) {
  try {
    window.localStorage.setItem(
      ACTIVE_LAUNCH_SESSION_STORAGE_KEY,
      JSON.stringify(session),
    );
  } catch {
    // Restoring the active chat is best-effort; the session list remains usable.
  }
}

export function clearStoredActiveLaunchSession() {
  try {
    window.localStorage.removeItem(ACTIVE_LAUNCH_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function clampSessionSidebarWidth(width: number) {
  return Math.min(
    SESSION_SIDEBAR_MAX_WIDTH,
    Math.max(SESSION_SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

export function readStoredSessionSidebarWidth() {
  if (typeof window === "undefined") return SESSION_SIDEBAR_DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(SESSION_SIDEBAR_WIDTH_STORAGE_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed)
    ? clampSessionSidebarWidth(parsed)
    : SESSION_SIDEBAR_DEFAULT_WIDTH;
}

export function writeStoredSessionSidebarWidth(width: number) {
  try {
    window.localStorage.setItem(
      SESSION_SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampSessionSidebarWidth(width)),
    );
  } catch {
    // Width persistence is cosmetic; dragging should still work.
  }
}

export function readCachedLaunchSessionGroups(
  scope: string,
  workspaces: WorkspaceItem[],
): ChatSessionWorkspaceGroup[] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(LAUNCH_SESSION_CACHE_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredLaunchSessionCache>;
    if (parsed.scope !== scope || !Array.isArray(parsed.groups)) {
      return undefined;
    }
    return normalizeSessionGroups(parsed.groups, workspaces);
  } catch {
    return undefined;
  }
}

export function writeCachedLaunchSessionGroups(
  scope: string,
  groups: ChatSessionWorkspaceGroup[],
) {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredLaunchSessionCache = {
      scope,
      syncedAt: Date.now(),
      groups,
    };
    window.localStorage.setItem(
      LAUNCH_SESSION_CACHE_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Session cache is an optimization; sync still works without storage.
  }
}
