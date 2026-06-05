import { ExternalLink, Play, RotateCw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { openDashboardUrl } from "@/lib/api";
import type { AgentRuntime } from "../hooks/useAgentsRuntime";
import type { ChannelRuntime } from "../hooks/useChannelsState";
import type { TunnelRuntime } from "../hooks/useTunnelsState";
import {
  agentDisplayName,
  basename,
  capitalize,
  channelDisplayName,
  channelPresentation,
  shortId,
  tunnelDetail,
  tunnelPresentation,
} from "./presentation";
import { AgentIconBadge, ServiceIconBadge } from "./serviceIcon";
import type { RuntimeStatusItem } from "./statusCard";
import type { Tone, Translate } from "./types";

const stopButtonClass =
  "border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive";

export function buildTunnelStatusItems({
  tunnels,
  kill,
  t,
}: {
  tunnels: TunnelRuntime[];
  kill: (provider: string) => unknown;
  t: Translate;
}): RuntimeStatusItem[] {
  return tunnels.map((tunnel) => {
    const presentation = tunnelPresentation(tunnel.status, t);
    const name = t("{{provider}} tunnel", {
      provider: capitalize(tunnel.provider),
    });
    const details: RuntimeStatusItem["details"] = [
      { label: t("Type"), value: t("Remote access") },
      { label: t("Name"), value: name },
      { label: t("Provider"), value: tunnel.provider },
      { label: t("Status"), value: presentation.label },
    ];
    if (tunnel.url) {
      details.push({
        label: t("URL"),
        value: (
          <button
            type="button"
            className="text-primary underline-offset-2 hover:underline"
            onClick={() => void openDashboardUrl(tunnel.url!)}
          >
            {tunnel.url}
          </button>
        ),
      });
    }
    const reason = tunnelDetail(tunnel.status);
    if (reason) {
      details.push({ label: t("Reason"), value: reason });
    }

    return {
      id: tunnel.provider,
      kind: "tunnel",
      name,
      status: presentation.label,
      tone: presentation.tone,
      icon: (
        <ServiceIconBadge
          id={tunnel.provider}
          kind="tunnel"
          tone={presentation.tone}
        />
      ),
      dialogIcon: (
        <ServiceIconBadge
          id={tunnel.provider}
          kind="tunnel"
          tone={presentation.tone}
          showStatus={false}
        />
      ),
      details,
      actions: (
        <>
          {tunnel.url && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-primary hover:text-primary"
              onClick={() => void openDashboardUrl(tunnel.url!)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("Open")}
            </Button>
          )}
          {tunnel.status.state === "running" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={stopButtonClass}
              onClick={() => kill(tunnel.provider)}
            >
              <Square className="h-3.5 w-3.5" />
              {t("Stop")}
            </Button>
          )}
        </>
      ),
    };
  });
}

export function buildChannelStatusItems({
  channels,
  start,
  stop,
  restart,
  t,
}: {
  channels: ChannelRuntime[];
  start: (kind: string) => unknown;
  stop: (kind: string) => unknown;
  restart: (kind: string) => unknown;
  t: Translate;
}): RuntimeStatusItem[] {
  return channels.map((channel) => {
    const presentation = channelPresentation(channel.status, t);
    const name = channelDisplayName(channel.kind);
    const running = channel.status === "running" || channel.status === "spawning";
    const details: RuntimeStatusItem["details"] = [
      { label: t("Type"), value: t("Messaging app") },
      { label: t("Name"), value: name },
      { label: t("Plugin version"), value: channel.version ?? t("Unknown") },
      { label: t("Status"), value: presentation.label },
    ];
    if (channel.reason) {
      details.push({ label: t("Reason"), value: channel.reason });
    }

    return {
      id: channel.kind,
      kind: "channel",
      name,
      status: presentation.label,
      tone: presentation.tone,
      icon: (
        <ServiceIconBadge
          id={channel.kind}
          kind="channel"
          tone={presentation.tone}
        />
      ),
      dialogIcon: (
        <ServiceIconBadge
          id={channel.kind}
          kind="channel"
          tone={presentation.tone}
          showStatus={false}
        />
      ),
      details,
      actions: (
        <>
          {running ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={stopButtonClass}
              onClick={() => stop(channel.kind)}
            >
              <Square className="h-3.5 w-3.5" />
              {t("Stop")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => start(channel.kind)}
            >
              <Play className="h-3.5 w-3.5" />
              {t("Start")}
            </Button>
          )}
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => restart(channel.kind)}
          >
            <RotateCw className="h-3.5 w-3.5" />
            {t("Restart")}
          </Button>
        </>
      ),
    };
  });
}

export function buildAgentStatusItems({
  agents,
  kill,
  t,
}: {
  agents: AgentRuntime[];
  kill: (routeKey: string) => unknown;
  t: Translate;
}): RuntimeStatusItem[] {
  return agents.map((agent) => {
    const failed = Boolean(agent.failed);
    const status = failed ? t("Failed") : agent.busy ? t("Busy") : t("Idle");
    const tone: Tone = failed ? "danger" : agent.busy ? "busy" : "good";
    const name = agentDisplayName(agent, t);
    const details: RuntimeStatusItem["details"] = [
      { label: t("Type"), value: t("Coding Agent") },
      { label: t("Name"), value: name },
      { label: t("Status"), value: status },
      { label: t("CLI"), value: agent.cli_kind ?? t("Unknown") },
      { label: t("Version"), value: agent.agent_version ?? t("Unknown") },
      {
        label: t("Workspace"),
        value: agent.workspace ? basename(agent.workspace) : t("Unknown"),
      },
      {
        label: t("Session"),
        value: agent.session_id ? shortId(agent.session_id) : t("Unknown"),
      },
      { label: t("Route"), value: agent.route_key },
      {
        label: t("Subagents"),
        value: String(agent.subagents.length + agent.multi_agent_turns.length),
      },
    ];
    if (agent.failed) {
      details.push({ label: t("Reason"), value: agent.failed });
    }

    return {
      id: agent.route_key,
      kind: "agent",
      name,
      status,
      tone,
      icon: (
        <AgentIconBadge
          cliKind={agent.cli_kind}
          label={name}
          tone={tone}
        />
      ),
      dialogIcon: (
        <AgentIconBadge
          cliKind={agent.cli_kind}
          label={name}
          tone={tone}
          showStatus={false}
        />
      ),
      details,
      actions: !failed ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={stopButtonClass}
          onClick={() => kill(agent.route_key)}
        >
          <Square className="h-3.5 w-3.5" />
          {t("Stop")}
        </Button>
      ) : null,
    };
  });
}
