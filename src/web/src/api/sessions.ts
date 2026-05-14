/**
 * Sessions API: list, create, delete. Base URL follows current page (works with tunnel).
 */

import {
  browserBaseUrl,
  CreateSessionResponseSchema,
  LaunchSessionListSchema,
  ProfileLaunchOptionsSchema,
  SessionListSchema,
  TmuxSessionsResponseSchema,
  type CreateSessionResponse,
  type LaunchSessionInfo,
  type ProfileLaunchOption,
  type PtyTool,
  type SessionListItem,
  type TmuxSessionsResponse,
} from "@va/client";

export type {
  CreateSessionResponse,
  LaunchSessionInfo,
  ProfileLaunchOption,
  SessionListItem,
  TmuxSessionsResponse,
};

export interface CreateSessionBody {
  tool?: PtyTool;
  profile_id?: string;
  launch_target?: string;
  project_path?: string;
  tmux_session?: string;
  /** "dark" | "light" — sets COLORFGBG in PTY env as fallback for non-OSC programs. */
  theme?: string;
  /** Initial terminal columns (from client fit). Server falls back to 80 if absent. */
  cols?: number;
  /** Initial terminal rows (from client fit). Server falls back to 24 if absent. */
  rows?: number;
}

export async function getSessions(): Promise<SessionListItem[]> {
  const res = await fetch(`${browserBaseUrl()}/api/sessions`);
  if (!res.ok) throw new Error(`GET /api/sessions: ${res.status}`);
  return SessionListSchema.parse(await res.json());
}

export async function getProfiles(): Promise<ProfileLaunchOption[]> {
  const res = await fetch(`${browserBaseUrl()}/api/profiles`);
  if (!res.ok) throw new Error(`GET /api/profiles: ${res.status}`);
  return ProfileLaunchOptionsSchema.parse(await res.json());
}

export async function getLaunchSessions(
  agentId: string,
  includeArchived = false,
): Promise<LaunchSessionInfo[]> {
  const params = new URLSearchParams();
  if (includeArchived) params.set("include_archived", "true");
  const query = params.toString();
  const path = `/api/agents/${encodeURIComponent(agentId)}/launch-sessions${query ? `?${query}` : ""}`;
  const res = await fetch(`${browserBaseUrl()}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return LaunchSessionListSchema.parse(await res.json());
}

export async function createSession(body: CreateSessionBody): Promise<CreateSessionResponse> {
  const res = await fetch(`${browserBaseUrl()}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /api/sessions: ${res.status} ${text}`);
  }
  return CreateSessionResponseSchema.parse(await res.json());
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${browserBaseUrl()}/api/sessions/${sessionId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(`DELETE /api/sessions: ${res.status}`);
}

export async function getTmuxSessions(): Promise<TmuxSessionsResponse> {
  const res = await fetch(`${browserBaseUrl()}/api/tmux/sessions`);
  if (!res.ok) throw new Error(`GET /api/tmux/sessions: ${res.status}`);
  return TmuxSessionsResponseSchema.parse(await res.json());
}
