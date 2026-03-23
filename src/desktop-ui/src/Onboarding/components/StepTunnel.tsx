import { Globe } from "lucide-react";

import { TUNNEL_LABELS, TUNNEL_PROVIDERS } from "../constants";
import type { StepTunnelProps } from "../types";

export function StepTunnel({
  provider,
  onProvider,
  ngrokToken,
  onNgrokToken,
  ngrokDomain,
  onNgrokDomain,
  cfToken,
  onCfToken,
  cfHostname,
  onCfHostname,
}: StepTunnelProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          Tunnel
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Expose your local server to the internet for IM webhooks and remote
          access. Skip if you only use it locally.
        </p>
      </div>

      <div className="flex gap-2">
        {TUNNEL_PROVIDERS.map((tp) => (
          <button
            key={tp}
            onClick={() => onProvider(tp)}
            className={`flex-1 text-xs font-medium py-2 rounded-md border transition-colors ${
              provider === tp
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-border/80"
            }`}
          >
            {TUNNEL_LABELS[tp]}
          </button>
        ))}
      </div>

      {provider === "ngrok" && (
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs text-muted-foreground">Auth Token</span>
            <input
              type="password"
              value={ngrokToken}
              onChange={(event) => onNgrokToken(event.target.value)}
              placeholder="2ljk…"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Domain (optional)</span>
            <input
              type="text"
              value={ngrokDomain}
              onChange={(event) => onNgrokDomain(event.target.value)}
              placeholder="myapp.ngrok-free.app"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
          </label>
        </div>
      )}

      {provider === "cloudflare" && (
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs text-muted-foreground">Tunnel Token</span>
            <input
              type="password"
              value={cfToken}
              onChange={(event) => onCfToken(event.target.value)}
              placeholder="eyJh…"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Hostname (optional)</span>
            <input
              type="text"
              value={cfHostname}
              onChange={(event) => onCfHostname(event.target.value)}
              placeholder="vibe.yourdomain.com"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
            />
          </label>
        </div>
      )}
    </div>
  );
}
