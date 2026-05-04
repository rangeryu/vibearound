import { useMemo, useState } from "react";
import { Check, Copy, Plug, ShieldCheck } from "lucide-react";
import { useI18n } from "@va/i18n";

import { BrandIcon } from "@/components/brand-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  CONNECTION_AGENTS,
  apiTypeProtocolLabel,
  apiTypeRouteLabel,
  emptyConnectionDraft,
  recommendedProxyTarget,
  resolveProfileConnection,
} from "./connections";
import type {
  ConnectionAgentId,
  ProfileConnectionPreference,
  ProfileConnections,
  ProfileSummary,
} from "./types";

const PLACEHOLDER_API_KEY = "anything-non-empty";

interface Props {
  profile: ProfileSummary;
  connections?: ProfileConnections;
  onClose: () => void;
  onSave: (
    agentId: ConnectionAgentId,
    preference: ProfileConnectionPreference,
  ) => Promise<void>;
}

export function ProfileConnectionDialog({
  profile,
  connections,
  onClose,
  onSave,
}: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => emptyConnectionDraft(profile, connections));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const resolved = useMemo(
    () =>
      CONNECTION_AGENTS.map((agent) =>
        resolveProfileConnection(profile, { [profile.id]: draft }, agent),
      ),
    [draft, profile],
  );

  async function copyManualValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      for (const agent of CONNECTION_AGENTS) {
        await onSave(agent.id, draft[agent.id]);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[760px]">
        <DialogHeader>
          <DialogTitle>{t("{{label}} Connections", { label: profile.label })}</DialogTitle>
          <DialogDescription>
            {t("Choose how Claude Code and Codex CLI connect through this profile.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 px-4 pb-1">
          {resolved.map((connection) => {
            const { agent } = connection;
            const current = draft[agent.id];
            const proxyTarget =
              current.targetApiType && connection.targetOptions.includes(current.targetApiType)
                ? current.targetApiType
                : recommendedProxyTarget(profile, agent.id);
            const canProxy = connection.targetOptions.length > 0;
            const statusLabel =
              connection.status === "via_proxy"
                ? t("Via proxy")
                : connection.status === "native"
                  ? t("Native")
                  : t("Unsupported");
            const manualConfig =
              canProxy && proxyTarget
                ? manualProxyConfig(profile.id, agent.id, proxyTarget)
                : null;

            return (
              <div
                key={agent.id}
                className="rounded-md border border-border bg-card p-3"
              >
                <div className="flex items-start gap-3">
                  <BrandIcon
                    kind="cli"
                    id={agent.id}
                    label={agent.label}
                    className="h-8 w-8"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[13px] font-semibold">{agent.label}</div>
                      <Badge
                        variant={connection.status === "unsupported" ? "muted" : "default"}
                        className={
                          connection.status === "via_proxy"
                            ? "bg-primary/10 text-primary"
                            : undefined
                        }
                      >
                        {statusLabel}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("Requires {{protocol}}", { protocol: agent.requiredProtocol })}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground">
                        <ShieldCheck className="h-3 w-3" />
                        {t("Default route")}
                      </span>
                      <span className="font-mono text-foreground/80">
                        {connection.native
                          ? `${profile.providerLabel} · ${apiTypeProtocolLabel(agent.requiredApiType)}`
                          : t("Unsupported")}
                      </span>
                    </div>
                  </div>

                  <label className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                    {t("Enable proxy")}
                    <Switch
                      checked={Boolean(current.proxyEnabled && canProxy)}
                      disabled={!canProxy || saving}
                      onCheckedChange={(checked) => {
                        setDraft((prev) => ({
                          ...prev,
                          [agent.id]: {
                            ...prev[agent.id],
                            proxyEnabled: checked,
                            targetApiType:
                              prev[agent.id].targetApiType ??
                              recommendedProxyTarget(profile, agent.id),
                          },
                        }));
                      }}
                    />
                  </label>
                </div>

                {current.proxyEnabled && canProxy && proxyTarget && (
                  <div className="mt-3 grid gap-2 border-t border-border/70 pt-3">
                    <div className="flex items-center gap-2">
                      <Plug className="h-3.5 w-3.5 text-primary" />
                      <div className="text-[11px] font-medium">{t("Proxy target")}</div>
                      <Select
                        value={proxyTarget}
                        onValueChange={(value) => {
                          setDraft((prev) => ({
                            ...prev,
                            [agent.id]: {
                              ...prev[agent.id],
                              proxyEnabled: true,
                              targetApiType: value,
                            },
                          }));
                        }}
                      >
                        <SelectTrigger size="sm" className="ml-auto h-7 w-[230px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {connection.targetOptions.map((apiType) => (
                            <SelectItem key={apiType} value={apiType} className="text-xs">
                              {profile.providerLabel} · {apiTypeProtocolLabel(apiType)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-md bg-primary/5 px-2 py-1.5 font-mono text-[11px] text-primary">
                      {agent.clientProtocol} -&gt; proxy -&gt; {profile.providerLabel}{" "}
                      {apiTypeRouteLabel(proxyTarget)}
                    </div>
                    {manualConfig && (
                      <div className="grid gap-2 rounded-md border border-border/70 bg-muted/30 p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-[11px] font-medium">
                            {t("Manual setup")}
                          </div>
                        </div>
                        <ManualValueRow
                          label={t("Base URL")}
                          value={manualConfig.baseUrl}
                          copied={copiedKey === manualConfig.copyKey}
                          copyLabel={t("Copy")}
                          copiedLabel={t("Copied")}
                          onCopy={() =>
                            copyManualValue(manualConfig.copyKey, manualConfig.baseUrl)
                          }
                        />
                        <ManualValueRow
                          label={t("API key")}
                          value={PLACEHOLDER_API_KEY}
                          copied={copiedKey === `${manualConfig.copyKey}:key`}
                          copyLabel={t("Copy")}
                          copiedLabel={t("Copied")}
                          onCopy={() =>
                            copyManualValue(
                              `${manualConfig.copyKey}:key`,
                              PLACEHOLDER_API_KEY,
                            )
                          }
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && <div className="px-4 text-[11px] text-destructive">{error}</div>}

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? t("Saving…") : t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function manualProxyConfig(
  profileId: string,
  agentId: ConnectionAgentId,
  targetApiType: string,
): { baseUrl: string; copyKey: string } {
  const path = [
    "local-api",
    encodeURIComponent(profileId),
    encodeURIComponent(agentId),
    encodeURIComponent(targetApiType),
  ].join("/");
  const versionSuffix = agentId === "claude" ? "" : "/v1";
  return {
    baseUrl: `${API_BASE}/${path}${versionSuffix}`,
    copyKey: `${agentId}:${targetApiType}:base-url`,
  };
}

function ManualValueRow({
  label,
  value,
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  onCopy: () => void;
}) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="min-w-0 break-all rounded-md bg-background px-2 py-1.5 font-mono text-[11px] text-foreground">
        {value}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-6 gap-1 px-1.5 text-[11px] font-medium text-primary hover:bg-transparent hover:text-primary"
        onClick={onCopy}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  );
}
