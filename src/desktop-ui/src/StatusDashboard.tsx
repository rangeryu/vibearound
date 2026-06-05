import {
  Bot,
  ExternalLink,
  Globe,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import { DAEMON_PORT, openDashboardUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  EmptyRuntime,
  RuntimeSection,
} from "./status-dashboard/primitives";
import {
  AgentIconBadge,
  ServiceIconBadge,
} from "./status-dashboard/serviceIcon";
import {
  RuntimeStatusCard,
  type RuntimeStatusItem,
} from "./status-dashboard/statusCard";
import {
  agentDisplayName,
  capitalize,
  channelDisplayName,
  channelPresentation,
  tunnelPresentation,
} from "./status-dashboard/presentation";
import {
  AgentRuntimeRow,
} from "./status-dashboard/runtimeRows";
import type { StatusDashboardProps, Tone } from "./status-dashboard/types";

export function StatusDashboard({
  channels,
  tunnels,
  agents,
  onRefresh,
}: StatusDashboardProps) {
  const { t } = useI18n();
  const tunnelIssues = tunnels.tunnels.filter(
    (tunnel) => tunnel.status.state === "failed",
  ).length;
  const channelIssues = channels.channels.filter(
    (channel) => channel.status === "crashed",
  ).length;
  const agentIssues = agents.agents.filter((agent) => agent.failed).length;
  const runningTunnels = tunnels.tunnels.filter(
    (tunnel) => tunnel.status.state === "running",
  ).length;
  const runningChannels = channels.channels.filter(
    (channel) => channel.status === "running" || channel.status === "spawning",
  ).length;
  const runningAgents = agents.agents.length;
  const anyLoading = channels.loading || tunnels.loading || agents.loading;
  const tunnelTone = runtimeTone(tunnelIssues, runningTunnels);
  const channelTone = runtimeTone(channelIssues, runningChannels);
  const agentTone = runtimeTone(agentIssues, runningAgents);
  const tunnelMetric =
    runningTunnels > 0
      ? {
          value: t("{{count}} active", { count: runningTunnels }),
          detail: t("{{count}} configured", { count: tunnels.tunnels.length }),
        }
      : {
          value: t("Off"),
          detail:
            tunnels.tunnels.length > 0
              ? t("{{count}} configured", { count: tunnels.tunnels.length })
              : t("No tunnel running"),
        };
  const channelMetric =
    runningChannels > 0
      ? {
          value: t("{{count}} running", { count: runningChannels }),
          detail: t("{{count}} enabled", { count: channels.channels.length }),
        }
      : {
          value: t("Off"),
          detail:
            channels.channels.length > 0
              ? t("{{count}} enabled", { count: channels.channels.length })
              : t("No apps enabled"),
        };
  const agentMetric =
    runningAgents > 0
      ? {
          value: t("{{count}} active", { count: runningAgents }),
          detail: t("active sessions"),
        }
      : {
          value: t("Off"),
          detail: t("No active agents"),
        };
  const tunnelStatuses: RuntimeStatusItem[] = tunnels.tunnels.map((tunnel) => {
    const presentation = tunnelPresentation(tunnel.status, t);
    return {
      id: tunnel.provider,
      kind: "tunnel",
      name: t("{{provider}} tunnel", { provider: capitalize(tunnel.provider) }),
      status: presentation.label,
      tone: presentation.tone,
      icon: (
        <ServiceIconBadge
          id={tunnel.provider}
          kind="tunnel"
          label={t("{{provider}} tunnel", { provider: capitalize(tunnel.provider) })}
          status={presentation.label}
          tone={presentation.tone}
        />
      ),
    };
  });
  const channelStatuses: RuntimeStatusItem[] = channels.channels.map((channel) => {
    const presentation = channelPresentation(channel.status, t);
    const name = channelDisplayName(channel.kind);
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
          label={name}
          status={presentation.label}
          tone={presentation.tone}
        />
      ),
    };
  });
  const agentStatuses: RuntimeStatusItem[] = agents.agents.map((agent) => {
    const failed = Boolean(agent.failed);
    const status = failed ? t("Failed") : agent.busy ? t("Busy") : t("Idle");
    const tone: Tone = failed ? "danger" : agent.busy ? "busy" : "good";
    const name = agentDisplayName(agent, t);
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
          status={status}
          tone={tone}
        />
      ),
    };
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-foreground">
                {t("Runtime Status")}
              </h2>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              {t(
                "Status across messaging apps, remote access, and coding agents.",
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="h-8 gap-1.5 text-xs"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", anyLoading && "animate-spin")}
              />
              {t("Refresh")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-primary hover:text-primary"
              onClick={(event) => {
                event.preventDefault();
                void openDashboardUrl(`http://127.0.0.1:${DAEMON_PORT}/va/`);
              }}
            >
              {t("Open Web Dashboard")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <RuntimeStatusCard
            icon={<MessageSquare className="h-4 w-4" />}
            title={t("Messaging apps")}
            value={channelMetric.value}
            detail={channelMetric.detail}
            tone={channelTone}
            statuses={channelStatuses}
            emptyStatus={t("Off")}
          />
          <RuntimeStatusCard
            icon={<Globe className="h-4 w-4" />}
            title={t("Remote access")}
            value={tunnelMetric.value}
            detail={tunnelMetric.detail}
            tone={tunnelTone}
            statuses={tunnelStatuses}
            emptyStatus={t("Off")}
          />
          <RuntimeStatusCard
            icon={<Bot className="h-4 w-4" />}
            title={t("Coding Agents")}
            value={agentMetric.value}
            detail={agentMetric.detail}
            tone={agentTone}
            statuses={agentStatuses}
            emptyStatus={t("Off")}
          />
        </div>

        <div className="grid gap-3">
          <RuntimeSection
            icon={<Bot className="h-4 w-4" />}
            title={t("Coding Agents")}
            subtitle={t("Agent sessions started by Launch or messaging apps.")}
            count={agents.agents.length}
          >
            {agents.agents.length === 0 ? (
              <EmptyRuntime
                title={t("No active agents")}
                description={t(
                  "Agents appear after Launch or a messaging conversation starts.",
                )}
              />
            ) : (
              agents.agents.map((agent) => (
                <AgentRuntimeRow
                  key={agent.route_key}
                  agent={agent}
                  onKill={() => agents.kill(agent.route_key)}
                  t={t}
                />
              ))
            )}
          </RuntimeSection>
        </div>
      </div>
    </div>
  );
}

function runtimeTone(issueCount: number, runningCount: number): Tone {
  if (issueCount > 0) return "danger";
  if (runningCount > 0) return "good";
  return "muted";
}
