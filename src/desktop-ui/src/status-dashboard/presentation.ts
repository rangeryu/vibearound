import type { TunnelStatus } from "@va/client";

import type { AgentRuntime } from "../hooks/useAgentsRuntime";
import type { ChannelRuntime } from "../hooks/useChannelsState";
import type { Tone, Translate } from "./types";

export function channelPresentation(
  status: ChannelRuntime["status"],
  t: Translate,
): { label: string; tone: Tone } {
  switch (status) {
    case "running":
      return { label: t("Running"), tone: "good" };
    case "spawning":
      return { label: t("Spawning"), tone: "warning" };
    case "crashed":
      return { label: t("Crashed"), tone: "danger" };
    case "stopped":
      return { label: t("Stopped"), tone: "muted" };
    case "not_started":
      return { label: t("Not started"), tone: "muted" };
  }
}

export function tunnelPresentation(
  status: TunnelStatus,
  t: Translate,
): { label: string; tone: Tone } {
  switch (status.state) {
    case "running":
      return { label: t("Running"), tone: "good" };
    case "failed":
      return { label: t("Failed"), tone: "danger" };
    case "stopped":
      return { label: t("Stopped"), tone: "muted" };
  }
}

export function tunnelDetail(status: TunnelStatus): string | null {
  switch (status.state) {
    case "failed":
      return status.error;
    case "stopped":
      return status.reason;
    case "running":
      return null;
  }
}

export function channelDisplayName(kind: string) {
  const known: Record<string, string> = {
    dingtalk: "DingTalk",
    discord: "Discord",
    feishu: "Feishu",
    slack: "Slack",
    telegram: "Telegram",
    wechat: "WeChat",
    wecom: "WeCom",
  };
  return known[kind] ?? capitalize(kind);
}

export function agentDisplayName(agent: AgentRuntime, t: Translate) {
  return agent.agent_title ?? agent.agent_name ?? agent.cli_kind ?? t("Coding Agent");
}

export function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

export function basename(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

export function shortId(value: string) {
  return value.length > 10 ? value.slice(0, 10) : value;
}

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
