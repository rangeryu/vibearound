import { ExternalLink, Play, RotateCw, Square, X } from "lucide-react";

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
import { RuntimeIconButton, RuntimeRow } from "./primitives";
import type { Tone, Translate } from "./types";

export function TunnelRuntimeRow({
  tunnel,
  onKill,
  t,
}: {
  tunnel: TunnelRuntime;
  onKill: () => unknown;
  t: Translate;
}) {
  const presentation = tunnelPresentation(tunnel.status, t);
  const details = [
    tunnel.provider,
    tunnel.url ?? tunnelDetail(tunnel.status),
  ].filter(Boolean);

  return (
    <RuntimeRow
      tone={presentation.tone}
      title={t("{{provider}} tunnel", { provider: capitalize(tunnel.provider) })}
      status={presentation.label}
      details={details}
      actions={
        <>
          {tunnel.url && (
            <RuntimeIconButton
              title={tunnel.url}
              onClick={() => void openDashboardUrl(tunnel.url!)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </RuntimeIconButton>
          )}
          {tunnel.status.state === "running" && (
            <RuntimeIconButton title={t("Stop")} onClick={onKill} danger>
              <X className="h-3.5 w-3.5" />
            </RuntimeIconButton>
          )}
        </>
      }
    />
  );
}

export function AgentRuntimeRow({
  agent,
  onKill,
  t,
}: {
  agent: AgentRuntime;
  onKill: () => unknown;
  t: Translate;
}) {
  const failed = Boolean(agent.failed);
  const tone: Tone = failed ? "danger" : agent.busy ? "busy" : "good";
  const title = agentDisplayName(agent, t);
  const subagentCount = agent.subagents.length + agent.multi_agent_turns.length;
  const details = [
    agent.cli_kind ?? null,
    agent.workspace ? basename(agent.workspace) : null,
    agent.session_id ? t("Session {{id}}", { id: shortId(agent.session_id) }) : null,
    agent.agent_version ? `v${agent.agent_version}` : null,
    subagentCount > 0 ? t("{{count}} subagents", { count: subagentCount }) : null,
    agent.failed,
  ].filter(Boolean);

  return (
    <RuntimeRow
      tone={tone}
      title={title}
      status={failed ? t("Failed") : agent.busy ? t("Busy") : t("Idle")}
      details={details}
      actions={
        !failed && (
          <RuntimeIconButton title={t("Stop")} onClick={onKill} danger>
            <X className="h-3.5 w-3.5" />
          </RuntimeIconButton>
        )
      }
    />
  );
}

export function ChannelRuntimeRow({
  channel,
  onStart,
  onStop,
  onRestart,
  t,
}: {
  channel: ChannelRuntime;
  onStart: () => unknown;
  onStop: () => unknown;
  onRestart: () => unknown;
  t: Translate;
}) {
  const presentation = channelPresentation(channel.status, t);
  const running = channel.status === "running" || channel.status === "spawning";
  const details = [channel.reason].filter(Boolean);

  return (
    <RuntimeRow
      tone={presentation.tone}
      title={channelDisplayName(channel.kind)}
      status={presentation.label}
      details={details}
      actions={
        <>
          {running ? (
            <RuntimeIconButton title={t("Stop")} onClick={onStop} danger>
              <Square className="h-3.5 w-3.5" />
            </RuntimeIconButton>
          ) : (
            <RuntimeIconButton title={t("Start")} onClick={onStart}>
              <Play className="h-3.5 w-3.5" />
            </RuntimeIconButton>
          )}
          <RuntimeIconButton title={t("Restart")} onClick={onRestart}>
            <RotateCw className="h-3.5 w-3.5" />
          </RuntimeIconButton>
        </>
      }
    />
  );
}
