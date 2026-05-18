import type { LaunchSessionInfo } from "@va/client";

const SESSION_SHORT_ID_LENGTH = 8;

export function shortSessionId(sessionId: string) {
  return sessionId.slice(0, SESSION_SHORT_ID_LENGTH);
}

export function formatSessionUpdatedAt(updatedAt: number) {
  if (!updatedAt) return "";
  return new Date(updatedAt * 1000).toLocaleString();
}

export function sessionMetaLabel(session: LaunchSessionInfo) {
  const updatedAt = formatSessionUpdatedAt(session.updated_at);
  return updatedAt ? `${session.short_id} - ${updatedAt}` : session.short_id;
}

export function workspaceLabel(workspace: string) {
  const normalized = workspace.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? workspace;
}

export function sortSessionsByUpdatedAt(sessions: LaunchSessionInfo[]) {
  return [...sessions].sort((a, b) => {
    const updatedDiff = b.updated_at - a.updated_at;
    if (updatedDiff !== 0) return updatedDiff;
    return b.session_id.localeCompare(a.session_id);
  });
}
