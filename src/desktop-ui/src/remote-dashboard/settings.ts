import type { AgentSummary, LauncherPreferences } from "../Launch/api";
import { agentProfileId } from "../Launch/launchModel";
import type { Settings as AppSettings } from "../Onboarding/types";
import {
  DIRECT_PROFILE,
  FOLLOW_DEFAULT,
  type AppDefaultForm,
  type ChannelDefaultForm,
  type RemoteChannelDefaults,
  type RemoteSettings,
} from "./types";

export function parseRemoteSettings(settings: AppSettings): RemoteSettings {
  const remote = isRecord(settings.remote) ? settings.remote : {};
  const channels = isRecord(remote.channels) ? remote.channels : {};
  const parsedChannels: Record<string, RemoteChannelDefaults> = {};
  for (const [id, value] of Object.entries(channels)) {
    if (isRecord(value)) parsedChannels[id] = value as RemoteChannelDefaults;
  }
  return { channels: parsedChannels };
}

export function configuredChannelIdsFromSettings(
  settings: AppSettings,
  remote: RemoteSettings,
): string[] {
  const ids = new Set<string>();
  if (isRecord(settings.channels)) {
    Object.keys(settings.channels).forEach((id) => ids.add(id));
  }
  Object.keys(remote.channels ?? {}).forEach((id) => ids.add(id));
  return [...ids];
}

export function formForChannel(
  remote: RemoteSettings,
  channelId: string,
): ChannelDefaultForm {
  const entry = remote.channels?.[channelId] ?? {};
  return {
    agentId: stringValue(entry.agent_id ?? entry.agentId ?? entry.agent) ?? FOLLOW_DEFAULT,
    profileId:
      stringValue(entry.profile_id ?? entry.profileId ?? entry.profile) ?? FOLLOW_DEFAULT,
  };
}

export function formForAppDefault(
  prefs: LauncherPreferences | null,
  agents: AgentSummary[],
): AppDefaultForm {
  const agentId = prefs?.defaultAgent ?? agents[0]?.id ?? "codex";
  return {
    agentId,
    profileId: prefs?.defaultProfileId ?? DIRECT_PROFILE,
  };
}

export function defaultChannelForm(): ChannelDefaultForm {
  return {
    agentId: FOLLOW_DEFAULT,
    profileId: FOLLOW_DEFAULT,
  };
}

export function defaultAppDefaultForm(): AppDefaultForm {
  return {
    agentId: "codex",
    profileId: DIRECT_PROFILE,
  };
}

export function updateRemoteChannelForm(
  settings: AppSettings,
  channelId: string,
  form: ChannelDefaultForm,
): AppSettings {
  const result: AppSettings = { ...settings };
  const remote = isRecord(settings.remote) ? { ...settings.remote } : {};
  const existingChannels = isRecord(remote.channels) ? remote.channels : {};
  const channels: Record<string, RemoteChannelDefaults> = {};
  for (const [id, value] of Object.entries(existingChannels)) {
    if (isRecord(value)) channels[id] = { ...(value as RemoteChannelDefaults) };
  }

  const entry: RemoteChannelDefaults = { ...(channels[channelId] ?? {}) };
  for (const key of [
    "agent",
    "agentId",
    "profile",
    "profileId",
    "workspace",
    "workspace_path",
    "workspacePath",
  ] as const) {
    delete entry[key];
  }
  if (form.agentId === FOLLOW_DEFAULT) delete entry.agent_id;
  else entry.agent_id = form.agentId;
  if (form.profileId === FOLLOW_DEFAULT) delete entry.profile_id;
  else entry.profile_id = form.profileId;

  if (Object.keys(entry).length > 0) channels[channelId] = entry;
  else delete channels[channelId];

  if (Object.keys(channels).length > 0) {
    remote.channels = channels;
  } else {
    delete remote.channels;
  }

  if (Object.keys(remote).length > 0) {
    result.remote = remote;
  } else {
    delete result.remote;
  }
  return result;
}

export function resolvedProfileIdForChannel(
  form: ChannelDefaultForm,
  prefs: LauncherPreferences | null,
  agentId: string,
): string | undefined {
  return form.profileId === FOLLOW_DEFAULT
    ? prefs
      ? agentProfileId(prefs, agentId)
      : undefined
    : form.profileId;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
