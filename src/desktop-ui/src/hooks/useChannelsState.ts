import { useCallback } from "react";
import {
  ChannelRuntimeListSchema,
  type ChannelRuntime,
} from "@va/client";
import { apiFetch } from "../lib/api";
import { useManagerState } from "./useManagerState";

export type { ChannelRuntime };

/**
 * Channels tab in the desktop dashboard. Subscribes to `/ws/channels`
 * for live updates and falls back to `/api/channels` polling on
 * disconnect. Exposes the stop/start/restart actions backed by the
 * existing `/api/services/channels/:kind/:action` endpoints.
 */
export function useChannelsState() {
  const base = useManagerState(
    "/api/channels",
    "/ws/channels",
    ChannelRuntimeListSchema,
  );

  const action = useCallback(
    async (kind: string, verb: "start" | "stop" | "restart") => {
      try {
        const res = await apiFetch(
          `/api/services/channels/${encodeURIComponent(kind)}/${verb}`,
          { method: "POST" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!base.connected) await base.refresh();
      } catch (e) {
        console.warn(`[useChannelsState] ${verb} ${kind} failed:`, e);
      }
    },
    [base],
  );

  return {
    channels: base.data,
    error: base.error,
    loading: base.loading,
    connected: base.connected,
    everLoaded: base.everLoaded,
    refresh: base.refresh,
    start: (kind: string) => action(kind, "start"),
    stop: (kind: string) => action(kind, "stop"),
    restart: (kind: string) => action(kind, "restart"),
  };
}
