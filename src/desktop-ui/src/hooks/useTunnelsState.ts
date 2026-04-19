import { useCallback } from "react";
import {
  TunnelRuntimeListSchema,
  type TunnelRuntime,
} from "@va/client";
import { apiFetch } from "../lib/api";
import { useManagerState } from "./useManagerState";

export type { TunnelRuntime };

/**
 * Tunnels tab in the desktop dashboard. Subscribes to `/ws/tunnels`
 * for live updates and falls back to `/api/tunnels` polling on
 * disconnect. `kill` routes through the existing
 * `DELETE /api/services/tunnels/:id` endpoint.
 */
export function useTunnelsState() {
  const base = useManagerState(
    "/api/tunnels",
    "/ws/tunnels",
    TunnelRuntimeListSchema,
  );

  const kill = useCallback(
    async (provider: string) => {
      try {
        const res = await apiFetch(
          `/api/services/tunnels/${encodeURIComponent(provider)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!base.connected) await base.refresh();
      } catch (e) {
        console.warn(`[useTunnelsState] kill ${provider} failed:`, e);
      }
    },
    [base],
  );

  return {
    tunnels: base.data,
    error: base.error,
    loading: base.loading,
    connected: base.connected,
    everLoaded: base.everLoaded,
    refresh: base.refresh,
    kill,
  };
}
