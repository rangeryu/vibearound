import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Copy,
  Loader2,
  Play,
  Search,
  Server,
  Square,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { BrandIcon } from "@/components/brand-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_BASE, DAEMON_PORT } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  getLauncherPreferences,
  listAgents,
  listProfiles,
  type AgentSummary,
  type LauncherPreferences,
} from "./Launch/api";
import {
  localAgentBasePath,
  type LocalAgentApiTarget,
} from "./Launch/localAgentApi";
import { LocalAgentApiPanel } from "./Launch/LocalAgentApiPanel";
import {
  agentWorkspace,
  isBridgeAgent,
  profileSupportsAgent,
} from "./Launch/launchModel";
import type { ProfileSummary } from "./Launch/types";

interface LocalApiRoute {
  id: string;
  agentId: string;
  agentLabel: string;
  profileId: string;
  profileLabel: string;
  providerId: string | null;
  providerLabel: string;
  providerIcon: string | null;
  enabled: boolean;
  workspacePath: string;
  target: LocalAgentApiTarget;
}

type RouteProbeState =
  | { status: "loading" }
  | { status: "ok"; latencyMs: number; modelCount: number }
  | { status: "error"; latencyMs: number; error: string };

export function LocalApiWorkbench({
  refreshToken = 0,
}: {
  refreshToken?: number;
}) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [prefs, setPrefs] = useState<LauncherPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [query, setQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [routeProbes, setRouteProbes] = useState<
    Record<string, RouteProbeState>
  >({});

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [nextAgents, nextProfiles, nextPrefs] = await Promise.all([
        listAgents(),
        listProfiles(),
        getLauncherPreferences(),
      ]);
      setAgents(nextAgents.filter((agent) => isBridgeAgent(agent.id)));
      setProfiles(nextProfiles);
      setPrefs(nextPrefs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  const visibleAgents = useMemo(() => {
    if (!prefs) return agents;
    const enabled = new Set(prefs.enabledAgents);
    return agents.filter((agent) => enabled.has(agent.id));
  }, [agents, prefs]);

  useEffect(() => {
    if (!prefs || visibleAgents.length === 0) return;
    if (agentId && visibleAgents.some((agent) => agent.id === agentId)) return;
    const preferred = visibleAgents.find(
      (agent) => agent.id === prefs.selectedAgent,
    );
    setAgentId((preferred ?? visibleAgents[0]).id);
  }, [agentId, prefs, visibleAgents]);

  const selectedAgent =
    visibleAgents.find((agent) => agent.id === agentId) ??
    visibleAgents[0] ??
    null;

  const routes = useMemo<LocalApiRoute[]>(() => {
    if (!selectedAgent || !prefs) return [];
    const workspacePath = agentWorkspace(prefs, selectedAgent.id);
    const directTarget: LocalAgentApiTarget = {
      agentId: selectedAgent.id,
      agentLabel: selectedAgent.display_name,
      profileId: "direct",
      profileLabel: t("Direct"),
      workspacePath,
    };
    const allRoutes: LocalApiRoute[] = [
      {
        id: `${selectedAgent.id}:direct`,
        agentId: selectedAgent.id,
        agentLabel: selectedAgent.display_name,
        profileId: "direct",
        profileLabel: t("Direct"),
        providerId: null,
        providerLabel: t("Use existing CLI login"),
        providerIcon: null,
        enabled: true,
        workspacePath,
        target: directTarget,
      },
      ...profiles.map((profile) => {
        const enabled = profileSupportsAgent(profile, selectedAgent.id, prefs);
        const target: LocalAgentApiTarget = {
          agentId: selectedAgent.id,
          agentLabel: selectedAgent.display_name,
          profileId: profile.id,
          profileLabel: profile.label,
          workspacePath,
        };
        return {
          id: `${selectedAgent.id}:${profile.id}`,
          agentId: selectedAgent.id,
          agentLabel: selectedAgent.display_name,
          profileId: profile.id,
          profileLabel: profile.label,
          providerId: profile.provider,
          providerLabel: profile.providerLabel,
          providerIcon: profile.providerIcon,
          enabled,
          workspacePath,
          target,
        };
      }),
    ];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return allRoutes;
    return allRoutes.filter((route) =>
      `${route.profileLabel} ${route.providerLabel} ${route.profileId}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [profiles, prefs, query, selectedAgent, t]);

  useEffect(() => {
    if (routes.length === 0) {
      setRouteId("");
      return;
    }
    if (routeId && routes.some((route) => route.id === routeId)) return;
    setRouteId((routes.find((route) => route.enabled) ?? routes[0]).id);
  }, [routeId, routes]);

  const selectedRoute =
    routes.find((route) => route.id === routeId) ?? routes[0] ?? null;
  const enabledCount = routes.filter((route) => route.enabled).length;
  const disabledCount = Math.max(0, routes.length - enabledCount);
  const probeValues = Object.values(routeProbes);
  const checkedCount = probeValues.filter(
    (probe) => probe.status === "ok" || probe.status === "error",
  ).length;
  const probeErrorCount = probeValues.filter(
    (probe) => probe.status === "error",
  ).length;
  const routeProbeKey = selectedRoute
    ? `${selectedRoute.id}:${selectedRoute.enabled ? "1" : "0"}:${selectedRoute.workspacePath}`
    : "";

  useEffect(() => {
    if (!selectedRoute || !selectedRoute.enabled) {
      return;
    }

    const controller = new AbortController();
    const route = selectedRoute;
    const startedAt = performance.now();
    setRouteProbes((current) => ({
      ...current,
      [route.id]: { status: "loading" },
    }));
    void fetch(`${API_BASE}${localAgentBasePath(route.target)}/models`, {
      headers: {
        "x-vibearound-cwd": route.workspacePath,
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        const latencyMs = Math.max(
          0,
          Math.round(performance.now() - startedAt),
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json().catch(() => null);
        const data =
          payload && typeof payload === "object"
            ? (payload as { data?: unknown }).data
            : null;
        const modelCount = Array.isArray(data) ? data.length : 0;
        setRouteProbes((current) => ({
          ...current,
          [route.id]: { status: "ok", latencyMs, modelCount },
        }));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const latencyMs = Math.max(
          0,
          Math.round(performance.now() - startedAt),
        );
        setRouteProbes((current) => ({
          ...current,
          [route.id]: {
            status: "error",
            latencyMs,
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      });

    return () => controller.abort();
  }, [routeProbeKey]);

  async function copyValue(key: string, value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1400);
    } catch {
      // Non-fatal; visible text remains selectable.
    }
  }

  if (loading) {
    return <p className="p-3 text-xs text-muted-foreground">{t("Loading…")}</p>;
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-destructive" role="alert">
        {error}
      </div>
    );
  }

  if (!selectedAgent || !prefs) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t("No local API agents enabled")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/15">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          <span className="font-semibold">{t("Local API service")}</span>
          <Badge className="h-5 rounded-md bg-primary/10 px-2 text-[11px] text-primary">
            {t("Running")}
          </Badge>
          <button
            type="button"
            className="ml-4 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2 font-mono text-[11px] text-foreground shadow-xs hover:bg-accent/45"
            onClick={() =>
              void copyValue("daemon-url", `http://127.0.0.1:${DAEMON_PORT}`)
            }
            title={t("Copy")}
          >
            127.0.0.1:{DAEMON_PORT}
            {copiedKey === "daemon-url" ? (
              <span className="font-sans text-[11px] text-primary">
                {t("Copied")}
              </span>
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
          <span className="hidden truncate text-[11px] text-muted-foreground md:inline">
            {t("Local only")} · {t("Path prefix")}{" "}
            <span className="font-mono">/va/local-agent/...</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            {t("Enabled")}{" "}
            <span className="font-mono text-foreground">{enabledCount}</span>
          </span>
          <span>
            {t("Disabled")}{" "}
            <span className="font-mono text-foreground">{disabledCount}</span>
          </span>
          <span>
            {t("Checked")}{" "}
            <span className="font-mono text-foreground">{checkedCount}</span>
          </span>
          <span>
            {t("Errors")}{" "}
            <span
              className={cn(
                "font-mono",
                probeErrorCount > 0 ? "text-destructive" : "text-foreground",
              )}
            >
              {probeErrorCount}
            </span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled
            title={t("Service stop is not available yet")}
          >
            <Square className="h-3 w-3 text-destructive" />
            {t("Stop service")}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-border bg-background/70">
          <div className="shrink-0 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <BrandIcon
                kind="cli"
                id={selectedAgent.id}
                label={selectedAgent.display_name}
                className="h-5 w-5"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {selectedAgent.display_name}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {routes.length} {t("routes")}
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
              {visibleAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={cn(
                    "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[11px]",
                    agent.id === selectedAgent.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent/45",
                  )}
                  onClick={() => {
                    setAgentId(agent.id);
                    setRouteId("");
                  }}
                >
                  <BrandIcon
                    kind="cli"
                    id={agent.id}
                    label={agent.display_name}
                    className="h-4 w-4"
                  />
                  {agent.display_name}
                </button>
              ))}
            </div>
            <label className="relative mt-3 block">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={t("Search profiles")}
                className="h-8 pl-7 text-xs"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <RouteSection
              title={t("Enabled routes")}
              routes={routes.filter((route) => route.enabled)}
              probes={routeProbes}
              selectedRouteId={selectedRoute?.id ?? ""}
              onSelect={setRouteId}
            />
            <RouteSection
              title={t("Disabled routes")}
              routes={routes.filter((route) => !route.enabled)}
              probes={routeProbes}
              selectedRouteId={selectedRoute?.id ?? ""}
              onSelect={setRouteId}
            />
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto px-6 py-5">
          {selectedRoute && (
            <div className="mx-auto grid max-w-[960px] gap-4">
              <section className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <BrandIcon
                    kind={
                      selectedRoute.profileId === "direct" ? "cli" : "provider"
                    }
                    id={
                      selectedRoute.profileId === "direct"
                        ? selectedRoute.agentId
                        : (selectedRoute.providerId ??
                          selectedRoute.providerLabel)
                    }
                    fallback={selectedRoute.providerIcon}
                    label={selectedRoute.profileLabel}
                    className="h-10 w-10"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="truncate text-xl font-semibold">
                        {selectedRoute.profileLabel}
                      </h1>
                      {selectedRoute.profileId === "direct" && (
                        <Badge
                          variant="outline"
                          className="h-5 rounded-md border-amber-300 bg-amber-50 px-1.5 text-[11px] text-amber-700"
                        >
                          {t("Default")}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {selectedRoute.providerLabel}
                    </p>
                  </div>
                </div>
                <Badge
                  className={cn(
                    "h-6 rounded-md px-2 text-[11px]",
                    selectedRoute.enabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {selectedRoute.enabled
                    ? t("Bridge enabled")
                    : t("Bridge disabled")}
                </Badge>
              </section>

              <section className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)] items-center gap-2">
                <RouteStep
                  title={t("Your client")}
                  detail={t("Any OpenAI / Anthropic SDK")}
                />
                <RouteArrow />
                <RouteStep
                  title={`:${DAEMON_PORT}`}
                  detail={t("Local API service")}
                  active
                />
                <RouteArrow />
                <RouteStep
                  title={`${selectedRoute.agentLabel} · ${selectedRoute.profileLabel}`}
                  detail={
                    selectedRoute.profileId === "direct"
                      ? t("Native local login")
                      : selectedRoute.providerLabel
                  }
                  active={selectedRoute.enabled}
                />
              </section>

              <LocalAgentApiPanel
                key={selectedRoute.id}
                target={selectedRoute.target}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function RouteSection({
  title,
  routes,
  probes,
  selectedRouteId,
  onSelect,
}: {
  title: string;
  routes: LocalApiRoute[];
  probes: Record<string, RouteProbeState>;
  selectedRouteId: string;
  onSelect: (routeId: string) => void;
}) {
  if (routes.length === 0) return null;
  return (
    <section className="mb-4">
      <div className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">
        {title} · {routes.length}
      </div>
      <div className="grid gap-1.5">
        {routes.map((route) => (
          <button
            key={route.id}
            type="button"
            className={cn(
              "flex min-h-[46px] w-full cursor-pointer items-center gap-2 rounded-md border px-2 text-left transition-colors",
              route.id === selectedRouteId
                ? "border-primary bg-card shadow-[inset_3px_0_0_hsl(var(--primary))]"
                : "border-transparent hover:border-border hover:bg-card",
              !route.enabled && "opacity-65",
            )}
            onClick={() => onSelect(route.id)}
          >
            <BrandIcon
              kind={route.profileId === "direct" ? "cli" : "provider"}
              id={
                route.profileId === "direct"
                  ? route.agentId
                  : (route.providerId ?? route.providerLabel)
              }
              fallback={route.providerIcon}
              label={route.profileLabel}
              className="h-7 w-7"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">
                {route.profileLabel}
              </span>
              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                {localAgentBasePath(route.target).replace("/local-agent/", "/")}
              </span>
            </span>
            <RouteProbeBadge enabled={route.enabled} probe={probes[route.id]} />
          </button>
        ))}
      </div>
    </section>
  );
}

function RouteProbeBadge({
  enabled,
  probe,
}: {
  enabled: boolean;
  probe?: RouteProbeState;
}) {
  if (!enabled) {
    return (
      <span className="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/50" />
    );
  }
  if (!probe) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />;
  }
  if (probe.status === "loading") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }
  if (probe.status === "error") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-destructive"
        title={probe.error}
      >
        <AlertCircle className="h-3 w-3" />
        {probe.latencyMs} ms
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      {probe.latencyMs} ms
    </span>
  );
}

function RouteStep({
  title,
  detail,
  active = false,
}: {
  title: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border px-3 py-2",
        active ? "border-primary/25 bg-primary/10" : "border-border bg-card",
      )}
    >
      <div className="truncate text-xs font-semibold text-foreground">
        {title}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

function RouteArrow() {
  return (
    <div className="flex h-6 items-center justify-center text-muted-foreground">
      <Play className="h-3 w-3" />
    </div>
  );
}
