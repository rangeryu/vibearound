import { useState, useEffect, useRef } from "react";
import {
  Globe, Bot, MessageSquare, Terminal, X, RefreshCw, ExternalLink, Server, Wifi, WifiOff, FolderOpen, Eye,
} from "lucide-react";
import { useServices, type ServiceInfo } from "./hooks/useServices";
import { openDashboardUrl } from "./lib/api";
import { Splash } from "./Splash";
import Onboarding from "./Onboarding";
import { Workspaces } from "./Workspaces";
import { Previews } from "./Previews";

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-red-500"
        : "bg-zinc-400";
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
  );
}

function ServiceRow({
  service,
  onKill,
}: {
  service: ServiceInfo;
  onKill: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-accent/50 transition-colors group">
      <StatusDot status={service.status} />
      <span className="text-xs font-medium flex-1 truncate">
        {service.name}
      </span>
      {service.provider && (
        <span className="text-[10px] text-muted-foreground/70 truncate max-w-[100px]">
          {service.provider}
        </span>
      )}
      {service.status === "running" && service.uptime_secs > 0 && (
        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
          {formatUptime(service.uptime_secs)}
        </span>
      )}
      {service.url && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            void openDashboardUrl(service.url!);
          }}
          className="text-muted-foreground/50 hover:text-primary"
          title={service.url}
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      )}
      {service.status === "running" && (
        <button
          onClick={onKill}
          className="text-muted-foreground/30 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
          title="Stop"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}



function App() {
  const [route, setRoute] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (route === "/onboarding") {
    return <Onboarding />;
  }

  return <Dashboard />;
}

type DashboardPage = "services" | "workspaces" | "previews";

function Dashboard() {
  const [page, setPage] = useState<DashboardPage>("services");
  const { data, error, connected, refresh, killService } = useServices();
  const everHadData = useRef(false);
  const [startTime] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);

  if (data) everHadData.current = true;

  // Auto-retry while waiting for server, timeout after 30s
  useEffect(() => {
    if (data || everHadData.current) return;
    if (timedOut) return;

    const elapsed = Date.now() - startTime;
    if (elapsed > 30_000) {
      setTimedOut(true);
      return;
    }

    if (error) {
      const timer = setTimeout(refresh, 2000);
      return () => clearTimeout(timer);
    }
  }, [data, error, timedOut, startTime, refresh]);

  // Show splash while waiting for first data (cold start)
  const showSplash = !everHadData.current && !data && !timedOut;

  if (showSplash) {
    return <Splash visible />;
  }

  // Server failed after timeout
  if (timedOut && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-destructive">Server failed to start</p>
        <button
          onClick={() => { setTimedOut(false); refresh(); }}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
          <button
            onClick={() => setPage("services")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
              page === "services" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Server className="w-3 h-3" />
            VibeAround
          </button>
          <button
            onClick={() => setPage("workspaces")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
              page === "workspaces" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FolderOpen className="w-3 h-3" />
            Workspaces
          </button>
          <button
            onClick={() => setPage("previews")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
              page === "previews" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Eye className="w-3 h-3" />
            Previews
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.location.replace("/onboarding")}
            className="text-xs text-primary hover:underline"
            title="Open Config Wizard"
          >
            Config Wizard
          </button>
          {connected ? (
            <span className="flex items-center gap-1 text-xs text-emerald-600">
              <Wifi className="w-3 h-3" /> Live
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <WifiOff className="w-3 h-3" /> Polling
            </span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">
            port {data.server.port}
          </span>
          <button
            onClick={refresh}
            className="p-1 rounded hover:bg-accent transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-1.5 bg-destructive/10 text-destructive text-xs">
          {error}
        </div>
      )}

      {/* Content */}
      {page === "workspaces" ? (
        <div className="flex-1 overflow-y-auto">
          <Workspaces />
        </div>
      ) : page === "previews" ? (
        <div className="flex-1 overflow-y-auto">
          <Previews />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Tunnel */}
        <Section
          icon={<Globe className="w-4 h-4 text-primary" />}
          title="Tunnel"
          badge={data.tunnels.length}
        >
          {data.tunnels.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">
              No tunnel running
            </p>
          ) : (
            data.tunnels.map((s) => (
              <ServiceRow
                key={s.id}
                service={s}
                onKill={() => killService("tunnels", s.id)}
              />
            ))
          )}
        </Section>

        {/* Agents */}
        <Section
          icon={<Bot className="w-4 h-4 text-primary" />}
          title="Agents"
          badge={data.agents.length}
        >
          {data.agents.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">
              No agents running
            </p>
          ) : (
            data.agents.map((s) => (
              <ServiceRow
                key={s.id}
                service={s}
                onKill={() => killService("agents", s.id)}
              />
            ))
          )}
        </Section>

        {/* Channels */}
        <Section
          icon={<MessageSquare className="w-4 h-4 text-primary" />}
          title="Channels"
          badge={data.channels.length}
        >
          {data.channels.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">
              No channels running
            </p>
          ) : (
            data.channels.map((s) => (
              <ServiceRow
                key={s.id}
                service={s}
                onKill={() => killService("channels", s.id)}
              />
            ))
          )}
        </Section>

        {/* PTY Sessions */}
        <Section
          icon={<Terminal className="w-4 h-4 text-primary" />}
          title="PTY Sessions"
          badge={data.pty_session_count}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm text-muted-foreground">
              {data.pty_session_count} active session{data.pty_session_count !== 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                void openDashboardUrl(`http://127.0.0.1:${data.server.port}/va/`);
              }}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              Open Web Dashboard <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </Section>
      </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  badge?: string | number;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
        {badge !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full tabular-nums">
            {badge}
          </span>
        )}
      </div>
      <div className="divide-y divide-border/50">{children}</div>
    </div>
  );
}

export default App;
