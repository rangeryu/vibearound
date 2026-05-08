import { useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  apiTypeProtocolLabel,
  apiTypeRouteLabel,
} from "./connections";
import type {
  ConnectionAgentId,
  ProfileConnectionPreference,
  ProfileSummary,
} from "./types";

const HTTP_HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const RESERVED_CUSTOM_HEADER_NAMES = new Set([
  "authorization",
  "connection",
  "content-length",
  "content-type",
  "host",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-api-key",
  "anthropic-version",
]);

export interface HeaderSetting {
  agentId: ConnectionAgentId;
  agentLabel: string;
  clientApiType: string;
  targetApiType: string;
  defaultHeaders: Record<string, string>;
  headers: Record<string, string>;
}

type HeaderValidationError = {
  key: string;
  params?: Record<string, string>;
};

export function HeaderSummaryButton({
  defaultHeaders,
  headers,
  disabled,
  onClick,
}: {
  defaultHeaders: Record<string, string>;
  headers: Record<string, string>;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const defaultCount = Object.keys(defaultHeaders).length;
  const customCount = countHeaders(headers);

  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      disabled={disabled}
      onClick={onClick}
      className="h-7 w-fit gap-1.5 rounded-md border-primary/40 bg-primary/5 px-2.5 text-[11px] font-medium text-primary shadow-xs hover:bg-primary/10 hover:text-primary"
    >
      <FileText className="h-3 w-3" />
      {t("Headers")}
      <span className="text-muted-foreground">
        {defaultCount + customCount}
        {customCount > 0 ? ` · +${customCount}` : ""}
      </span>
    </Button>
  );
}

export function HeaderSettingDialog({
  setting,
  onSave,
  onClose,
}: {
  setting: HeaderSetting;
  onSave: (headers: Record<string, string>) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [headers, setHeaders] = useState(setting.headers);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    const validationError = validateHeaderMap(
      setting.defaultHeaders,
      headers,
      setting.clientApiType,
    );
    if (validationError) {
      setError(t(validationError.key, validationError.params));
      return;
    }
    onSave(pruneHeaderMap(headers));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(620px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>{t("Headers")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("Configure proxy headers.")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-4 pb-1">
          <div className="font-mono text-[11px] leading-5 text-primary">
            {setting.agentLabel} ·{" "}
            {apiTypeProtocolDisplayLabel(setting.clientApiType)} -&gt;{" "}
            {apiTypeRouteDisplayLabel(setting.targetApiType)}
          </div>
          <ProxyHeadersField
            defaultHeaders={setting.defaultHeaders}
            headers={headers}
            onChange={setHeaders}
          />
        </div>
        {error && <div className="px-4 text-[11px] text-destructive">{error}</div>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            {t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProxyHeadersField({
  defaultHeaders,
  headers,
  onChange,
}: {
  defaultHeaders: Record<string, string>;
  headers: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const defaultEntries = Object.entries(defaultHeaders);
  const entries = Object.entries(headers);

  function updateName(oldName: string, nextName: string) {
    const next = { ...headers };
    const value = next[oldName] ?? "";
    delete next[oldName];
    next[nextName] = value;
    onChange(next);
  }

  function updateValue(name: string, value: string) {
    onChange({ ...headers, [name]: value });
  }

  function removeHeader(name: string) {
    const next = { ...headers };
    delete next[name];
    onChange(next);
  }

  function addHeader() {
    if (Object.prototype.hasOwnProperty.call(headers, "")) return;
    onChange({ ...headers, "": "" });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-muted-foreground">
          {t("Headers")}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={addHeader}
          aria-label={t("Add header")}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {defaultEntries.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium text-muted-foreground">
            {t("Default headers")}
          </div>
          {defaultEntries.map(([name, value]) => (
            <div
              key={`default-${name}`}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-1.5"
            >
              <Input
                type="text"
                value={name}
                disabled
                readOnly
                className="h-7 w-full font-mono text-xs"
              />
              <Input
                type="text"
                value={value}
                disabled
                readOnly
                className="h-7 w-full font-mono text-xs"
              />
              <div aria-hidden className="h-7 w-8" />
            </div>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-medium text-muted-foreground">
            {t("Append headers")}
          </div>
          {entries.map(([name, value], index) => (
            <div
              key={`${name}-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-1.5"
            >
              <Input
                type="text"
                value={name}
                onChange={(event) => updateName(name, event.currentTarget.value)}
                placeholder="HTTP-Referer"
                className="h-7 w-full font-mono text-xs"
              />
              <Input
                type="text"
                value={value}
                onChange={(event) => updateValue(name, event.currentTarget.value)}
                placeholder="https://app.example"
                className="h-7 w-full font-mono text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removeHeader(name)}
                aria-label={t("Remove header")}
                className="h-7 w-8"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function validateProxyHeaders(
  profile: ProfileSummary,
  preference: ProfileConnectionPreference,
): HeaderValidationError | null {
  for (const [clientApiType, proxy] of Object.entries(preference.proxy ?? {})) {
    if (!proxy?.enabled) continue;
    const targetApiType = proxy.targetApiType;
    if (!targetApiType) continue;
    const error = validateHeaderMap(
      profile.apiTypeHeaders[targetApiType] ?? {},
      proxy.headers ?? {},
      clientApiType,
    );
    if (error) return error;
  }
  return null;
}

function validateHeaderMap(
  defaultHeaders: Record<string, string>,
  headers: Record<string, string>,
  context: string,
): HeaderValidationError | null {
  const defaultHeaderNames = new Set(
    Object.keys(defaultHeaders).map((name) => name.toLowerCase()),
  );
  const customHeaderNames = new Set<string>();
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim();
    const value = rawValue.trim();
    if (!name && !value) continue;
    if (!name) {
      return {
        key: "Header name is required for {{context}}",
        params: { context },
      };
    }
    if (!value) {
      return {
        key: "Header value is required for {{context}} header {{name}}",
        params: { context, name },
      };
    }
    if (!HTTP_HEADER_NAME_RE.test(name)) {
      return {
        key: "Header {{name}} is not a valid HTTP header name",
        params: { name },
      };
    }
    if (/[\r\n]/.test(value)) {
      return {
        key: "Header {{name}} value cannot contain line breaks",
        params: { name },
      };
    }
    if (RESERVED_CUSTOM_HEADER_NAMES.has(name.toLowerCase())) {
      return {
        key: "Header {{name}} is managed by the proxy",
        params: { name },
      };
    }
    const lowerName = name.toLowerCase();
    if (defaultHeaderNames.has(lowerName)) {
      return {
        key: "Header {{name}} is already provided by {{context}}",
        params: { name, context },
      };
    }
    if (customHeaderNames.has(lowerName)) {
      return {
        key: "Header {{name}} is duplicated for {{context}}",
        params: { name, context },
      };
    }
    customHeaderNames.add(lowerName);
  }
  return null;
}

function pruneHeaderMap(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim();
    const value = rawValue.trim();
    if (name && value) out[name] = value;
  }
  return out;
}

function countHeaders(headers: Record<string, string>): number {
  return Object.entries(headers).filter(
    ([name, value]) => name.trim() && value.trim(),
  ).length;
}

function apiTypeProtocolDisplayLabel(apiType: string): string {
  return apiTypeProtocolLabel(apiType);
}

function apiTypeRouteDisplayLabel(apiType: string): string {
  return apiTypeRouteLabel(apiType);
}
