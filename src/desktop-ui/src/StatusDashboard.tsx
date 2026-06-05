import {
  Activity,
  Bot,
  ExternalLink,
  Globe,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DAEMON_PORT, openDashboardUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  EmptyRuntime,
  MetricTile,
  RuntimeSection,
  StatusPill,
  StatusPulse,
} from "./status-dashboard/primitives";
import {
  AgentRuntimeRow,
  ChannelRuntimeRow,
  TunnelRuntimeRow,
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
  const issueCount = tunnelIssues + channelIssues + agentIssues;
  const runningTunnels = tunnels.tunnels.filter(
    (tunnel) => tunnel.status.state === "running",
  ).length;
  const runningChannels = channels.channels.filter(
    (channel) => channel.status === "running" || channel.status === "spawning",
  ).length;
  const runningAgents = agents.agents.length;
  const liveConnections =
    Number(channels.connected) + Number(tunnels.connected) + Number(agents.connected);
  const anyLoading = channels.loading || tunnels.loading || agents.loading;
  const activeRuntimeCount = runningTunnels + runningChannels + runningAgents;
  const overallTone: Tone =
    issueCount > 0 ? "danger" : activeRuntimeCount > 0 ? "good" : "muted";
  const overallLabel =
    issueCount > 0
      ? t("Needs attention")
      : activeRuntimeCount > 0
        ? t("Operational")
        : t("Standby");
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusPulse tone={overallTone} />
              <h2 className="text-[15px] font-semibold text-foreground">
                {t("Runtime console")}
              </h2>
              <StatusPill tone={overallTone}>{overallLabel}</StatusPill>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              {t(
                "Live health across local services, remote access, and messaging entry points.",
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

        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <MetricTile
            icon={<Activity className="h-4 w-4" />}
            label={t("Overall")}
            value={overallLabel}
            detail={
              issueCount > 0
                ? t("{{count}} needs attention", { count: issueCount })
                : t("{{count}} active runtimes", {
                    count: activeRuntimeCount,
                  })
            }
            tone={overallTone}
          />
          <MetricTile
            icon={<Globe className="h-4 w-4" />}
            label={t("Remote access")}
            value={tunnelMetric.value}
            detail={tunnelMetric.detail}
            tone={tunnelIssues > 0 ? "danger" : runningTunnels > 0 ? "good" : "muted"}
          />
          <MetricTile
            icon={<Bot className="h-4 w-4" />}
            label={t("Coding Agents")}
            value={String(agents.agents.length)}
            detail={
              agentIssues > 0
                ? t("{{count}} needs attention", { count: agentIssues })
                : agents.agents.length > 0
                  ? t("active sessions")
                  : t("No active agents")
            }
            tone={
              agentIssues > 0
                ? "danger"
                : agents.agents.length > 0
                  ? "busy"
                  : "muted"
            }
          />
          <MetricTile
            icon={<MessageSquare className="h-4 w-4" />}
            label={t("Messaging apps")}
            value={channelMetric.value}
            detail={channelMetric.detail}
            tone={
              channelIssues > 0
                ? "danger"
                : runningChannels > 0
                  ? "good"
                  : "muted"
            }
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <RuntimeSection
            icon={<Globe className="h-4 w-4" />}
            title={t("Remote access")}
            subtitle={t("Public routes and tunnel process state.")}
            count={tunnels.tunnels.length}
            connected={tunnels.connected}
            loading={tunnels.loading}
          >
            {tunnels.tunnels.length === 0 ? (
              <EmptyRuntime
                title={t("No active tunnel")}
                description={t("Remote access is off until a tunnel starts.")}
              />
            ) : (
              tunnels.tunnels.map((tunnel) => (
                <TunnelRuntimeRow
                  key={tunnel.provider}
                  tunnel={tunnel}
                  onKill={() => tunnels.kill(tunnel.provider)}
                  t={t}
                />
              ))
            )}
          </RuntimeSection>

          <RuntimeSection
            icon={<Bot className="h-4 w-4" />}
            title={t("Coding Agents")}
            subtitle={t("Live agent hosts started by Launch or messaging apps.")}
            count={agents.agents.length}
            connected={agents.connected}
            loading={agents.loading}
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

        <RuntimeSection
          icon={<MessageSquare className="h-4 w-4" />}
          title={t("Messaging apps")}
          subtitle={t("Bot connectors and restart health.")}
          count={channels.channels.length}
          connected={channels.connected}
          loading={channels.loading}
        >
          {channels.channels.length === 0 ? (
            <EmptyRuntime
              title={t("No messaging apps running")}
              description={t("Enable a messaging app in Settings to receive commands.")}
            />
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {channels.channels.map((channel) => (
                <ChannelRuntimeRow
                  key={channel.kind}
                  channel={channel}
                  onStart={() => channels.start(channel.kind)}
                  onStop={() => channels.stop(channel.kind)}
                  onRestart={() => channels.restart(channel.kind)}
                  t={t}
                />
              ))}
            </div>
          )}
        </RuntimeSection>

        <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
          <span>{t("Data source")}</span>
          <Badge variant="secondary" className="h-5 rounded-md px-2 text-[10px]">
            {t("{{count}} of 3 live", { count: liveConnections })}
          </Badge>
        </div>
      </div>
    </div>
  );
}
