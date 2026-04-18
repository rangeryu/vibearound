import { useState, useEffect, useCallback, useRef } from "react";
import type { ApiServiceStatus } from "@va/generated/ApiServiceStatus";
import { apiFetch, authedWsUrl } from "../lib/api";

export type { ApiServiceStatus };

const POLL_INTERVAL = 5000;
const WS_RECONNECT_DELAY = 3000;

export interface ServiceInfo {
  id: string;
  category: string;
  name: string;
  status: ApiServiceStatus;
  uptime_secs: number;
  provider?: string;
  url?: string;
  kind?: string;
  workspace?: string;
  role?: "manager" | "worker";
  // --- Channel-only extras from ChannelMonitor snapshot ---
  reason?: string;
  crash_count?: number;
  last_seen_age_secs?: number;
  restart_in_secs?: number;
}

export interface ServerMeta {
  started_at: number;
  port: number;
}

export interface ServicesSnapshot {
  server: ServerMeta;
  tunnels: ServiceInfo[];
  agents: ServiceInfo[];
  channels: ServiceInfo[];
  pty_session_count: number;
}

export function useServices() {
  const [data, setData] = useState<ServicesSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // HTTP fallback fetch
  const fetchServices = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/services`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ServicesSnapshot = await res.json();
      setData(json);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Start HTTP polling fallback
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    fetchServices();
    pollRef.current = setInterval(fetchServices, POLL_INTERVAL);
  }, [fetchServices]);

  // Stop HTTP polling
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // WebSocket connection
  const connectWs = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const url = await authedWsUrl("/ws/services");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      stopPolling();
    };

    ws.onmessage = (event) => {
      try {
        const snapshot: ServicesSnapshot = JSON.parse(event.data);
        setData(snapshot);
        setError(null);
        setLoading(false);
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Fallback to polling, then try to reconnect WS
      startPolling();
      setTimeout(() => {
        void connectWs();
      }, WS_RECONNECT_DELAY);
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }, [stopPolling, startPolling]);

  useEffect(() => {
    void connectWs();
    return () => {
      stopPolling();
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWs, stopPolling]);

  const killService = useCallback(
    async (category: string, id: string) => {
      try {
        const res = await apiFetch(
          `/api/services/${encodeURIComponent(category)}/${encodeURIComponent(id)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // If WS is connected, server will push the update.
        // If not, fetch manually.
        if (!connected) await fetchServices();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Kill failed");
      }
    },
    [connected, fetchServices]
  );

  /** Channel-specific lifecycle controls backed by ChannelMonitor.
   *  `start`   — transition a Stopped channel back to Crashed(restart_at=now)
   *              so the next tick respawns it.
   *  `restart` — kill current runtime + immediate respawn (intent=Restart). */
  const channelAction = useCallback(
    async (kind: string, action: "start" | "restart" | "stop") => {
      try {
        const res = await apiFetch(
          `/api/services/channels/${encodeURIComponent(kind)}/${action}`,
          { method: "POST" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!connected) await fetchServices();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : `${action} failed`);
      }
    },
    [connected, fetchServices]
  );

  return {
    data,
    error,
    loading,
    connected,
    refresh: fetchServices,
    killService,
    channelAction,
  };
}
