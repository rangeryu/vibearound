/**
 * WebSocket URL from current page host/protocol so it works on PC (localhost)
 * and on mobile via tunnel (same host, wss when page is https).
 *
 * Browsers cannot set custom headers on WebSocket handshakes, so the server
 * also accepts the auth token via the `?token=` query parameter. This helper
 * appends it automatically from `sessionStorage`.
 */
import { getAuthToken } from "./auth";

export function getWebSocketUrl(path: string): string {
  const base =
    typeof window === "undefined"
      ? `ws://127.0.0.1:12358${path}`
      : (() => {
          const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
          const host = window.location.host;
          return `${protocol}//${host}${path}`;
        })();

  const token = getAuthToken();
  if (!token) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}
