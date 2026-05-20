import { useMemo, useState } from "react";
import { AlertTriangle, FileText, Info, Plug, ShieldCheck } from "lucide-react";
import { useI18n } from "@va/i18n";

import { BrandIcon } from "@/components/brand-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  HeaderSettingDialog,
  HeaderSummaryButton,
  type HeaderSetting,
} from "./ProfileConnectionHeaders";
import {
  ManualSettingDialog,
  ManualValueRow,
  PLACEHOLDER_API_KEY,
  buildManualSetting,
  manualProxyConfig,
  type ManualSetting,
} from "./ProfileConnectionManualGuide";
import type {
  ConnectionAgentId,
  ModelDef,
  ProfileConnectionPreference,
  ProfileConnections,
  ProfileSummary,
} from "./types";

interface Props {
  profile: ProfileSummary;
  agentId: ConnectionAgentId;
  connections?: ProfileConnections;
  onClose: () => void;
  onSave: (
    agentId: ConnectionAgentId,
    preference: ProfileConnectionPreference,
  ) => Promise<void>;
}

export function ProfileConnectionDialog({
  profile,
  agentId,
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
  const [headerSetting, setHeaderSetting] = useState<HeaderSetting | null>(null);

  const resolved = useMemo(
    () => {
      const agent = CONNECTION_AGENTS.find((item) => item.id === agentId);
      return agent
        ? [resolveProfileConnection(profile, { [profile.id]: draft }, agent)]
        : [];
    },
    [agentId, draft, profile],
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
      await onSave(agentId, draft[agentId]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function updateProxyHeaders(setting: HeaderSetting, headers: Record<string, string>) {
    setDraft((prev) => ({
      ...prev,
      [setting.agentId]: {
        ...prev[setting.agentId],
        selectedApiType:
          prev[setting.agentId].selectedApiType ?? setting.clientApiType,
        proxy: {
          ...(prev[setting.agentId].proxy ?? {}),
          [setting.clientApiType]: {
            ...(prev[setting.agentId].proxy?.[setting.clientApiType] ?? {}),
            enabled: true,
            targetApiType: setting.targetApiType,
            headers,
          },
        },
      },
    }));
  }

  return (
    <>
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setManualSetting(null);
          setHeaderSetting(null);
          onClose();
        }
      }}
    >
      <DialogContent className="w-[min(740px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>{t("{{label}} Connections", { label: profile.label })}</DialogTitle>
          <DialogDescription>
            {t("Choose how coding agents connect through this profile.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto px-4 pb-1">
          {resolved.map((connection) => {
            const { agent } = connection;
            const current = draft[agent.id];
            const selectedApiType =
              current.selectedApiType && agent.supportedApiTypes.includes(current.selectedApiType)
                ? current.selectedApiType
                : connection.selectedApiType;
            const selectedConnection =
              connection.clientApiTypes.find((item) => item.apiType === selectedApiType) ??
              connection.selected;
            const statusLabel =
              connection.status === "via_proxy"
                ? t("Via API bridge")
                : connection.status === "native"
                  ? t("Native")
                  : t("Unsupported");
            const selectedCurrentProxy = current.proxy?.[selectedApiType] ?? {};
            const selectedProxyTarget =
              selectedCurrentProxy.targetApiType &&
              selectedConnection.targetOptions.includes(selectedCurrentProxy.targetApiType)
                ? selectedCurrentProxy.targetApiType
                : recommendedProxyTarget(profile, agent.id, selectedApiType);
            const selectedUpstreamModel =
              cleanModelId(selectedCurrentProxy.upstreamModel) ||
              (selectedProxyTarget ? profile.apiTypeModels[selectedProxyTarget] : "") ||
              "";
            const selectedCanProxy = selectedConnection.targetOptions.length > 0;
            const selectedProxyEnabled = Boolean(
              selectedCurrentProxy.enabled && selectedCanProxy,
            );
            const handleSelectedProxyToggle = (checked: boolean) => {
              setDraft((prev) => ({
                ...prev,
                [agent.id]: {
                  ...prev[agent.id],
                  selectedApiType:
                    prev[agent.id].selectedApiType ?? selectedApiType,
                  proxy: {
                    ...(prev[agent.id].proxy ?? {}),
                    [selectedApiType]: {
                      ...(prev[agent.id].proxy?.[selectedApiType] ?? {}),
                      enabled: checked,
                      targetApiType:
                        prev[agent.id].proxy?.[selectedApiType]?.targetApiType ??
                        selectedProxyTarget,
                      upstreamModel:
                        prev[agent.id].proxy?.[selectedApiType]?.upstreamModel ??
                        selectedUpstreamModel,
                    },
                  },
                },
              }));
            };
            const authNotice = agentAuthNotice(agent.id);

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
                      {authNotice && connection.status !== "unsupported" && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span className="truncate">{t(authNotice)}</span>
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("Client API: {{protocol}}", {
                        protocol: apiTypeProtocolDisplayLabel(selectedApiType),
                      })}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground">
                        <ShieldCheck className="h-3 w-3" />
                        {t("Selected route")}
                      </span>
                      <span className="font-mono text-foreground/80">
                        {selectedConnection.native
                          ? `${profile.providerLabel} · ${apiTypeProtocolDisplayLabel(selectedApiType)}`
                          : selectedConnection.proxyEnabled && selectedConnection.targetApiType
                            ? `${apiTypeProtocolDisplayLabel(selectedApiType)} -> ${profile.providerLabel} ${apiTypeRouteDisplayLabel(selectedConnection.targetApiType)}`
                          : t("Unsupported")}
                      </span>
                    </div>
                  </div>

                  {agent.supportedApiTypes.length > 1 && (
                    <Select
                      value={selectedApiType}
                      onValueChange={(value) => {
                        setDraft((prev) => ({
                          ...prev,
                          [agent.id]: {
                            ...prev[agent.id],
                            selectedApiType: value,
                          },
                        }));
                      }}
                    >
                      <SelectTrigger size="sm" className="h-8 w-[clamp(10rem,24vw,220px)] shrink-0 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {agent.supportedApiTypes.map((apiType) => (
                          <SelectItem key={apiType} value={apiType} className="text-xs">
                            {apiTypeProtocolDisplayLabel(apiType)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <label className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                    {t("Enable API bridge")}
                    <Switch
                      checked={selectedProxyEnabled}
                      disabled={!selectedCanProxy || saving}
                      onCheckedChange={handleSelectedProxyToggle}
                    />
                  </label>
                </div>

                <div className="mt-3 grid gap-2 border-t border-border/70 pt-3">
                  {connection.clientApiTypes.map((client) => {
                    const currentProxy = current.proxy?.[client.apiType] ?? {};
                    const proxyTarget =
                      currentProxy.targetApiType &&
                      client.targetOptions.includes(currentProxy.targetApiType)
                        ? currentProxy.targetApiType
                        : recommendedProxyTarget(profile, agent.id, client.apiType);
                    const upstreamModel =
                      cleanModelId(currentProxy.upstreamModel) ||
                      (proxyTarget ? profile.apiTypeModels[proxyTarget] : "") ||
                      "";
                    const fakeModelId = cleanModelId(currentProxy.fakeModelId);
                    const agentModel = fakeModelId || upstreamModel;
                    const upstreamModelOptions = proxyModelOptions(
                      profile,
                      proxyTarget,
                      upstreamModel,
                    );
                    const canProxy = client.targetOptions.length > 0;
                    const proxyEnabled = Boolean(currentProxy.enabled && canProxy);
                    const manualConfig =
                      canProxy && proxyTarget && agentModel
                        ? manualProxyConfig(
                            profile.id,
                            agent.id,
                            client.apiType,
                            proxyTarget,
                            agentModel,
                          )
                        : null;
                    if (!proxyEnabled || !canProxy || !proxyTarget) {
                      return null;
                    }

                    return (
                      <div
                        key={client.apiType}
                        className={`rounded-md border p-2 ${
                          selectedApiType === client.apiType
                            ? "border-primary/35 bg-primary/5"
                            : "border-border/70 bg-muted/20"
                        }`}
                      >
                        {proxyEnabled && canProxy && proxyTarget && (
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <Plug className="h-3.5 w-3.5 text-primary" />
                              <div className="text-[11px] font-medium">{t("Target API")}</div>
                              <div className="ml-auto">
                                <HeaderSummaryButton
                                  defaultHeaders={profile.apiTypeHeaders[proxyTarget] ?? {}}
                                  headers={currentProxy.headers ?? {}}
                                  disabled={saving}
                                  onClick={() =>
                                    setHeaderSetting({
                                      agentId: agent.id,
                                      agentLabel: agent.label,
                                      clientApiType: client.apiType,
                                      targetApiType: proxyTarget,
                                      defaultHeaders: profile.apiTypeHeaders[proxyTarget] ?? {},
                                      headers: currentProxy.headers ?? {},
                                    })
                                  }
                                />
                              </div>
                              <Select
                                value={proxyTarget}
                                onValueChange={(value) => {
                                  const nextModel = profile.apiTypeModels[value] ?? "";
                                  setDraft((prev) => ({
                                    ...prev,
                                    [agent.id]: {
                                      ...prev[agent.id],
                                      selectedApiType:
                                        prev[agent.id].selectedApiType ?? client.apiType,
                                      proxy: {
                                        ...(prev[agent.id].proxy ?? {}),
                                        [client.apiType]: {
                                          ...(prev[agent.id].proxy?.[client.apiType] ?? {}),
                                          enabled: true,
                                          targetApiType: value,
                                          upstreamModel: nextModel,
                                          headers: {},
                                        },
                                      },
                                    },
                                  }));
                                }}
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="!h-7 min-h-0 w-[clamp(10rem,28vw,210px)] px-2.5 py-0 text-[11px] leading-none [&_svg]:h-3.5 [&_svg]:w-3.5"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {client.targetOptions.map((apiType) => (
                                    <SelectItem key={apiType} value={apiType} className="text-xs">
                                      {profile.providerLabel} ·{" "}
                                      {apiTypeProtocolDisplayLabel(apiType)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                              <label className="grid min-w-0 gap-1 text-[11px] text-muted-foreground">
                                <span>{t("Fake model id")}</span>
                                <Input
                                  value={fakeModelId}
                                  disabled={saving}
                                  className="h-7 w-full font-mono text-xs"
                                  placeholder={agentModel || t("Optional")}
                                  onChange={(event) => {
                                    const value = event.currentTarget.value;
                                    setDraft((prev) => ({
                                      ...prev,
                                      [agent.id]: {
                                        ...prev[agent.id],
                                        selectedApiType:
                                          prev[agent.id].selectedApiType ?? client.apiType,
                                        proxy: {
                                          ...(prev[agent.id].proxy ?? {}),
                                          [client.apiType]: {
                                            ...(prev[agent.id].proxy?.[client.apiType] ?? {}),
                                            enabled: true,
                                            targetApiType: proxyTarget,
                                            upstreamModel,
                                            fakeModelId: value,
                                          },
                                        },
                                      },
                                    }));
                                  }}
                                />
                              </label>
                              <label className="grid min-w-0 gap-1 text-[11px] text-muted-foreground">
                                <span>{t("Target model")}</span>
                                <Select
                                  value={upstreamModel}
                                  disabled={saving}
                                  onValueChange={(value) => {
                                    setDraft((prev) => ({
                                      ...prev,
                                      [agent.id]: {
                                        ...prev[agent.id],
                                        selectedApiType:
                                          prev[agent.id].selectedApiType ?? client.apiType,
                                        proxy: {
                                          ...(prev[agent.id].proxy ?? {}),
                                          [client.apiType]: {
                                            ...(prev[agent.id].proxy?.[client.apiType] ?? {}),
                                            enabled: true,
                                            targetApiType: proxyTarget,
                                            upstreamModel: value,
                                          },
                                        },
                                      },
                                    }));
                                  }}
                                >
                                  <SelectTrigger
                                    size="sm"
                                    className="!h-7 min-h-0 w-full px-2.5 py-0 font-mono text-[11px] leading-none [&_svg]:h-3.5 [&_svg]:w-3.5"
                                  >
                                    <SelectValue placeholder={t("Select model")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {upstreamModelOptions.map((model) => (
                                      <SelectItem
                                        key={model.id}
                                        value={model.id}
                                        className="text-xs"
                                      >
                                        {model.label || model.id}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </label>
                            </div>
                            <div className="font-mono text-[11px] leading-5 text-primary">
                              {apiTypeProtocolDisplayLabel(client.apiType)} -&gt;{" "}
                              {t("API bridge")} -&gt; {profile.providerLabel}{" "}
                              {apiTypeRouteDisplayLabel(proxyTarget)}
                              {upstreamModel ? ` · ${upstreamModel}` : ""}
                              {fakeModelId ? ` ${t("as")} ${fakeModelId}` : ""}
                            </div>
                            {manualConfig && (
                              <div className="rounded-md border border-border/70 bg-muted/30 p-2">
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <div className="text-[11px] font-medium">
                                    {t("Manual setup")}
                                  </div>
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="xs"
                                    className="h-auto cursor-pointer gap-1 px-0 py-0 text-[11px] font-medium"
                                    onClick={() =>
                                      setManualSetting(
                                        buildManualSetting(
                                          profile,
                                          agent.id,
                                          agent.label,
                                          client.apiType,
                                          proxyTarget,
                                          manualConfig,
                                        ),
                                      )
                                    }
                                  >
                                    <FileText className="h-3 w-3" />
                                    {t("Setup guide")}
                                  </Button>
                                  <div className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <Info className="h-3 w-3" />
                                    {t("Click a value to copy.")}
                                  </div>
                                </div>
                                <div className="grid gap-0.5">
                                  <ManualValueRow
                                    label={t("Base URL")}
                                    value={manualConfig.baseUrl}
                                    copied={copiedKey === manualConfig.copyKey}
                                    onCopy={() =>
                                      copyManualValue(manualConfig.copyKey, manualConfig.baseUrl)
                                    }
                                  />
                                  <ManualValueRow
                                    label={t("Model")}
                                    value={manualConfig.model}
                                    copied={copiedKey === `${manualConfig.copyKey}:model`}
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
    {headerSetting && (
      <HeaderSettingDialog
        setting={headerSetting}
        onSave={(headers) => {
          updateProxyHeaders(headerSetting, headers);
          setHeaderSetting(null);
        }}
        onClose={() => setHeaderSetting(null)}
      />
    )}
    </>
  );
}

function apiTypeProtocolDisplayLabel(apiType: string): string {
  return apiTypeProtocolLabel(apiType);
}

function apiTypeRouteDisplayLabel(apiType: string): string {
  return apiTypeRouteLabel(apiType);
}

function agentAuthNotice(agentId: ConnectionAgentId): string | null {
  switch (agentId) {
    case "claude":
      return "If Claude login overrides this profile, run claude auth logout first.";
    case "codex":
      return "If Codex login overrides this profile, run codex logout first.";
    case "gemini":
      return "If Gemini uses OAuth, run /auth and choose Gemini API key first.";
    default:
      return null;
  }
}

function cleanModelId(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function proxyModelOptions(
  profile: ProfileSummary,
  targetApiType: string | null,
  currentModel: string,
): ModelDef[] {
  const options = targetApiType ? [...(profile.apiTypeModelOptions[targetApiType] ?? [])] : [];
  const model = cleanModelId(currentModel);
  if (model && !options.some((option) => option.id === model)) {
    options.unshift({ id: model, label: null });
  }
  return options;
}
