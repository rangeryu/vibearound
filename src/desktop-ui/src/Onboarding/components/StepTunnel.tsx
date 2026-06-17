import { useI18n } from "@va/i18n";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { StepTunnelProps } from "../types";

export function StepTunnel({
  tunnels,
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
  showProviderSelect = false,
  notice,
}: StepTunnelProps) {
  const { t } = useI18n();
  const selectedTunnel = tunnels.find((tunnel) => tunnel.id === provider);

  if (!selectedTunnel && !showProviderSelect) return null;

  return (
    <div className="space-y-4">
      {notice}
      {showProviderSelect ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {orderedTunnels(tunnels).map((tunnel) => {
            const selected = tunnel.id === provider;
            return (
              <button
                key={tunnel.id}
                type="button"
                className={cn(
                  "min-h-20 rounded-md border px-3 py-3 text-left transition-colors",
                  selected
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-background hover:border-primary/30",
                )}
                onClick={() => onProvider(tunnel.id)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {tunnel.display_name}
                  </span>
                  {tunnel.id === "cloudflare" && (
                    <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                      {t("Recommended")}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {tunnelSettingsDescription(tunnel.id, t)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        selectedTunnel && (
          <div className="flex gap-2">
            <div className="flex min-h-8 flex-1 items-center justify-center rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
              {selectedTunnel.display_name}
              {selectedTunnel.id === "cloudflare" && (
                <span className="ml-1 text-[10px] opacity-70">
                  {t("Recommended")}
                </span>
              )}
            </div>
          </div>
        )
      )}

      {provider === "none" && (
        <div className="rounded-md border border-border bg-muted/20 px-4 py-4 text-xs text-muted-foreground">
          {t("Remote access is disabled. VibeAround stays available on this computer only.")}
        </div>
      )}

      {provider === "localtunnel" && (
        <div className="rounded-md border border-border bg-muted/20 px-4 py-4 text-xs text-muted-foreground">
          {t("LocalTunnel does not require credentials. Save and restart services to apply this provider.")}
        </div>
      )}

      {provider === "ngrok" && (
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("Auth Token")}</span>
            <Input
              type="password"
              value={ngrokToken}
              onChange={(event) => onNgrokToken(event.target.value)}
              placeholder="2ljk…"
              className="mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("Domain (optional)")}</span>
            <Input
              type="text"
              value={ngrokDomain}
              onChange={(event) => onNgrokDomain(event.target.value)}
              placeholder="myapp.ngrok-free.app"
              className="mt-1"
            />
          </label>
        </div>
      )}

      {provider === "cloudflare" && (
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("Tunnel Token")}</span>
            <Input
              type="password"
              value={cfToken}
              onChange={(event) => onCfToken(event.target.value)}
              placeholder="eyJh…"
              className="mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("Hostname (optional)")}</span>
            <Input
              type="text"
              value={cfHostname}
              onChange={(event) => onCfHostname(event.target.value)}
              placeholder="vibe.yourdomain.com"
              className="mt-1"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function orderedTunnels(tunnels: StepTunnelProps["tunnels"]) {
  const rank = new Map([
    ["none", 0],
    ["cloudflare", 1],
    ["localtunnel", 2],
    ["ngrok", 3],
  ]);
  return [...tunnels].sort(
    (a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99),
  );
}

function tunnelSettingsDescription(
  id: string,
  t: (key: string) => string,
) {
  switch (id) {
    case "none":
      return t("Local access only; no public tunnel is started.");
    case "cloudflare":
      return t("Stable remote access through a Cloudflare Tunnel token.");
    case "localtunnel":
      return t("Quick public URL through localtunnel, with no API key.");
    case "ngrok":
      return t("Remote access through an Ngrok account token.");
    default:
      return t("Remote access provider.");
  }
}
