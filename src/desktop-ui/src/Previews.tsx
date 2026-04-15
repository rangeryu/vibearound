import { useCallback, useEffect, useState } from "react";
import {
  Eye, ExternalLink, Globe, Trash2, RefreshCw, FileText, Server,
} from "lucide-react";
import { apiFetch, openDashboardUrl, API_BASE } from "./lib/api";

interface PreviewSnapshot {
  slug: string;
  id: string;
  workspace: string;
  title: string;
  kind: "server" | "file";
  port: number | null;
  share_key: string | null;
  share_expires_at_ms: number | null;
  created_at_ms: number;
}

interface PreviewsResponse {
  previews: PreviewSnapshot[];
  tunnel_url: string | null;
}

const POLL_INTERVAL_MS = 5000;

export function Previews() {
  const [data, setData] = useState<PreviewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchPreviews = useCallback(async () => {
    setError("");
    try {
      const res = await apiFetch(`/api/previews`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreviews();
    const id = setInterval(fetchPreviews, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchPreviews]);

  const closePreview = async (slug: string) => {
    try {
      const res = await apiFetch(`/api/previews/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) throw new Error(await res.text());
      fetchPreviews();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const tunnelUrl = data?.tunnel_url ?? null;
  const localBase = API_BASE.replace(/\/va\/?$/, "");

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Eye className="w-4 h-4 text-primary" />
          Previews
        </h2>
        <button
          onClick={fetchPreviews}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Refresh"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-muted-foreground ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Active dev-server proxies and markdown previews. Owner links are
        permanent; share links rotate every 10 minutes. Closing a server
        preview also kills the underlying dev server process.
      </p>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {data?.previews.map((p, i) => (
          <PreviewRow
            key={p.slug}
            preview={p}
            tunnelUrl={tunnelUrl}
            localBase={localBase}
            isFirst={i === 0}
            onClose={() => closePreview(p.slug)}
          />
        ))}
        {(!data || data.previews.length === 0) && !loading && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No active previews. Ask your coding agent to run{" "}
            <span className="font-mono">preview</span> or{" "}
            <span className="font-mono">md_preview</span>.
          </div>
        )}
      </div>
    </div>
  );
}

interface PreviewRowProps {
  preview: PreviewSnapshot;
  tunnelUrl: string | null;
  localBase: string;
  isFirst: boolean;
  onClose: () => void;
}

function PreviewRow({ preview, tunnelUrl, localBase, isFirst, onClose }: PreviewRowProps) {
  const ownerPath = `/va/preview/u/${encodeURIComponent(preview.slug)}`;
  const sharePath = preview.share_key
    ? `/va/preview/s/${encodeURIComponent(preview.share_key)}`
    : null;

  const localOwnerUrl = `${localBase}${ownerPath}`;
  const tunnelOwnerUrl = tunnelUrl ? `${tunnelUrl}${ownerPath}` : null;
  const tunnelShareUrl = tunnelUrl && sharePath ? `${tunnelUrl}${sharePath}` : null;

  const Icon = preview.kind === "server" ? Server : FileText;

  return (
    <div className={`px-4 py-3 ${isFirst ? "" : "border-t border-border"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Icon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold truncate">{preview.title}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  preview.kind === "server"
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-blue-500/10 text-blue-600"
                }`}
              >
                {preview.kind}
              </span>
              {preview.port != null && (
                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">
                  :{preview.port}
                </span>
              )}
            </div>
            <div
              className="text-xs text-muted-foreground font-mono truncate mt-0.5"
              title={preview.id}
            >
              {preview.id}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-destructive/10 transition-colors shrink-0"
          title={preview.kind === "server" ? "Close (kills dev server)" : "Close"}
        >
          <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <UrlButton
          label="Local"
          url={localOwnerUrl}
          icon={<ExternalLink className="w-3 h-3" />}
        />
        <UrlButton
          label="Tunnel · owner"
          url={tunnelOwnerUrl}
          icon={<Globe className="w-3 h-3" />}
          disabledReason={tunnelOwnerUrl ? null : "Tunnel not running"}
        />
        <UrlButton
          label="Tunnel · share"
          url={tunnelShareUrl}
          icon={<Globe className="w-3 h-3" />}
          disabledReason={
            !tunnelUrl
              ? "Tunnel not running"
              : !sharePath
                ? "Share key expired"
                : null
          }
        />
      </div>
    </div>
  );
}

interface UrlButtonProps {
  label: string;
  url: string | null;
  icon: React.ReactNode;
  disabledReason?: string | null;
}

function UrlButton({ label, url, icon, disabledReason }: UrlButtonProps) {
  const disabled = !url || !!disabledReason;
  const onClick = () => {
    if (!url) return;
    void openDashboardUrl(url);
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? disabledReason ?? "Unavailable" : url ?? ""}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
        disabled
          ? "bg-muted text-muted-foreground/50 cursor-not-allowed"
          : "bg-primary/10 text-primary hover:bg-primary/20"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
