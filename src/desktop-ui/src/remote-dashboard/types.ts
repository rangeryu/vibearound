export const FOLLOW_DEFAULT = "__default__";
export const DIRECT_PROFILE = "direct";

export type RemoteSelection =
  | { kind: "channel"; id: string }
  | { kind: "tunnel"; id: string };

export type ChannelDefaultForm = {
  agentId: string;
  profileId: string;
};

export type Notice = {
  variant: "success" | "warning" | "error";
  message: string;
};

export type AppDefaultForm = {
  agentId: string;
  profileId: string;
};

export type RemoteChannelDefaults = {
  agent_id?: string;
  agentId?: string;
  agent?: string;
  profile_id?: string;
  profileId?: string;
  profile?: string;
  workspace?: string;
  workspace_path?: string;
  workspacePath?: string;
};

export type RemoteSettings = {
  channels?: Record<string, RemoteChannelDefaults>;
};
