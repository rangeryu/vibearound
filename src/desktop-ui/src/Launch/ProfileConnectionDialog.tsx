import { useMemo, useState } from "react";
import { Check, Copy, FileText, Plug, ShieldCheck } from "lucide-react";
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

interface ManualProxyConfig {
  baseUrl: string;
  model: string;
  copyKey: string;
}

interface ManualSetting {
  agentId: ConnectionAgentId;
  agentLabel: string;
  copyKey: string;
  filePath: string;
  profileName?: string;
  snippet: string;
}

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
  const [manualSetting, setManualSetting] = useState<ManualSetting | null>(null);

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
    <>
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setManualSetting(null);
          onClose();
        }
      }}
    >
      <DialogContent className="w-[760px]">
        <DialogHeader>
          <DialogTitle>{t("{{label}} Connections", { label: profile.label })}</DialogTitle>
          <DialogDescription>
            {t("Choose how Claude Code and Codex CLI connect through this profile.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto px-4 pb-1">
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
                ? manualProxyConfig(
                    profile.id,
                    agent.id,
                    proxyTarget,
                    profile.apiTypeModels[proxyTarget],
                  )
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
	                      {manualConfig && (
	                        <Button
	                          type="button"
	                          variant="outline"
	                          size="xs"
	                          className="ml-auto h-7 gap-1.5 rounded-md border-primary/40 bg-primary/5 px-2.5 text-[11px] font-medium text-primary shadow-xs hover:bg-primary/10 hover:text-primary"
	                          onClick={() =>
	                            setManualSetting(
	                              buildManualSetting(
	                                profile,
	                                agent.id,
	                                agent.label,
	                                proxyTarget,
	                                manualConfig,
	                              ),
	                            )
	                          }
	                        >
	                          <FileText className="h-3 w-3" />
	                          {t("Manual setting")}
	                        </Button>
	                      )}
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
	                        <SelectTrigger size="sm" className="h-7 w-[230px] text-xs">
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
                      <div className="rounded-md border border-border/70 bg-muted/30 p-2">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <div className="text-[11px] font-medium">
                            {t("Manual setup")}
                          </div>
                        </div>
                        <div className="grid gap-0.5">
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
                            label={t("Model")}
                            value={manualConfig.model}
                            copied={copiedKey === `${manualConfig.copyKey}:model`}
                            copyLabel={t("Copy")}
                            copiedLabel={t("Copied")}
                            onCopy={() =>
                              copyManualValue(
                                `${manualConfig.copyKey}:model`,
                                manualConfig.model,
                              )
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
    {manualSetting && (
      <ManualSettingDialog
        setting={manualSetting}
        copiedKey={copiedKey}
        onCopy={copyManualValue}
        onClose={() => setManualSetting(null)}
      />
    )}
    </>
  );
}

function manualProxyConfig(
  profileId: string,
  agentId: ConnectionAgentId,
  targetApiType: string,
  model: string | undefined,
): ManualProxyConfig {
  const path = [
    "local-api",
    encodeURIComponent(profileId),
    encodeURIComponent(agentId),
    encodeURIComponent(targetApiType),
  ].join("/");
  const versionSuffix = agentId === "claude" ? "" : "/v1";
  return {
    baseUrl: `${API_BASE}/${path}${versionSuffix}`,
    model: model ?? "",
    copyKey: `${agentId}:${targetApiType}:base-url`,
  };
}

function buildManualSetting(
  profile: ProfileSummary,
  agentId: ConnectionAgentId,
  agentLabel: string,
  targetApiType: string,
  manualConfig: ManualProxyConfig,
): ManualSetting {
  const model = manualConfig.model || "<model-id>";
  if (agentId === "codex") {
    const profileName = codexProfileName(profile.id, targetApiType);
    const providerName = profileName;
    return {
      agentId,
      agentLabel,
      copyKey: `${manualConfig.copyKey}:codex-config`,
      filePath: "~/.codex/config.toml",
      profileName,
      snippet: [
        `profile = ${tomlString(profileName)}`,
        "",
        `[profiles.${profileName}]`,
        `model = ${tomlString(model)}`,
        `model_provider = ${tomlString(providerName)}`,
        `model_reasoning_effort = "medium"`,
        "",
        `[model_providers.${providerName}]`,
        `name = ${tomlString(`VibeAround ${profile.providerLabel}`)}`,
        `base_url = ${tomlString(manualConfig.baseUrl)}`,
        `wire_api = "responses"`,
        `requires_openai_auth = false`,
      ].join("\n"),
    };
  }

  return {
    agentId,
    agentLabel,
    copyKey: `${manualConfig.copyKey}:claude-settings`,
    filePath: "~/.claude/settings.json",
    snippet: `"env": ${JSON.stringify(
      {
        ANTHROPIC_BASE_URL: manualConfig.baseUrl,
        ANTHROPIC_API_KEY: PLACEHOLDER_API_KEY,
        ANTHROPIC_MODEL: model,
      },
      null,
      2,
    )}`,
  };
}

function codexProfileName(profileId: string, targetApiType: string): string {
  return `vibearound_${safeConfigKey(profileId)}_${safeConfigKey(targetApiType)}`;
}

function safeConfigKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "profile";
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function ManualSettingDialog({
  setting,
  copiedKey,
  onCopy,
  onClose,
}: {
  setting: ManualSetting;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const isCodex = setting.agentId === "codex";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[700px]">
        <DialogHeader>
          <DialogTitle>
            {t("{{agent}} manual setting", { agent: setting.agentLabel })}
          </DialogTitle>
          <DialogDescription>
            {t("Copy this snippet into the CLI config file yourself. VibeAround does not edit the file automatically.")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 min-h-0 gap-3 overflow-y-auto px-4 pb-4">
          <div className="grid gap-2 rounded-md border border-border/70 bg-muted/25 p-3 text-[12px]">
            <ConfigInfoRow label={t("Configuration file")} value={setting.filePath} />
          </div>

          <div className="rounded-md border border-border/70 p-3">
            <div className="text-[12px] font-medium">{t("How to modify")}</div>
            <ol className="mt-2 space-y-1.5 pl-4 text-[12px] leading-relaxed text-muted-foreground">
              {isCodex ? (
                <>
                  <li>{t("Open the Codex config file, then add this snippet or update the existing VibeAround profile block.")}</li>
                  <li>{t("The top-level profile line makes plain codex use this VibeAround profile by default.")}</li>
                </>
              ) : (
                <>
                  <li>{t("Paste this property inside the root JSON object of Claude settings.")}</li>
                  <li>{t("If env already exists, merge these keys into the existing env object instead of creating another env block.")}</li>
                </>
              )}
            </ol>
          </div>

          <ConfigSnippetBlock
            title={isCodex ? t("Codex config snippet") : t("Config snippet")}
            snippet={setting.snippet}
            copied={copiedKey === setting.copyKey}
            onCopy={() => onCopy(setting.copyKey, setting.snippet)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfigSnippetBlock({
  title,
  snippet,
  copied,
  onCopy,
}: {
  title: string;
  snippet: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className={`overflow-hidden rounded-md border ${
        copied
          ? "border-primary/60 bg-primary/10"
          : "border-primary/30 bg-primary/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-primary/20 px-3 py-2">
        <div className="text-[12px] font-medium text-primary">{title}</div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 gap-1.5 px-2 text-[11px] font-medium text-primary hover:bg-primary/10 hover:text-primary"
          onClick={onCopy}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? t("Copied") : t("Copy config")}
        </Button>
      </div>
      <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
        {snippet}
      </pre>
    </div>
  );
}

function ConfigInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="shrink-0 text-muted-foreground">{label}</div>
      <div className="break-all font-mono text-foreground">{value}</div>
    </div>
  );
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
      <div className="min-w-0 break-all rounded-md bg-background px-2 py-0 font-mono text-[11px] leading-5 text-foreground">
        {value}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-5 gap-1 px-1.5 text-[11px] font-medium text-primary hover:bg-primary/10 hover:text-primary"
        onClick={onCopy}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? copiedLabel : copyLabel}
      </Button>
    </div>
  );
}
