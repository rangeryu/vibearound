import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  MessageSquare,
  Send,
  Server,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_BASE, apiFetch, getAuthToken } from "@/lib/api";

type LocalApiProtocol = "openai-responses" | "openai-chat" | "anthropic";

export interface LocalAgentApiTarget {
  agentId: string;
  agentLabel: string;
  profileId: string;
  profileLabel: string;
  workspacePath: string;
}

interface LocalAgentApiDialogProps {
  target: LocalAgentApiTarget | null;
  onClose: () => void;
}

interface TestResult {
  ok: boolean;
  status: number;
  text: string;
}

const PROTOCOLS: Array<{
  id: LocalApiProtocol;
  label: string;
  shortLabel: string;
  endpoint: string;
}> = [
  {
    id: "openai-responses",
    label: "OpenAI Responses",
    shortLabel: "Responses",
    endpoint: "responses",
  },
  {
    id: "openai-chat",
    label: "OpenAI Chat Completions",
    shortLabel: "Chat",
    endpoint: "chat/completions",
  },
  {
    id: "anthropic",
    label: "Anthropic Messages",
    shortLabel: "Anthropic",
    endpoint: "messages",
  },
];

export function LocalAgentApiDialog({
  target,
  onClose,
}: LocalAgentApiDialogProps) {
  const { t } = useI18n();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [modelsStatus, setModelsStatus] = useState<string | null>(null);
  const [protocol, setProtocol] =
    useState<LocalApiProtocol>("openai-responses");
  const [prompt, setPrompt] = useState("Reply with exactly: VA_LOCAL_API_OK");
  const [model, setModel] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const basePath = target ? localAgentBasePath(target) : "";
  const baseUrl = target ? `${API_BASE}${basePath}` : "";
  const selectedProtocol =
    PROTOCOLS.find((item) => item.id === protocol) ?? PROTOCOLS[0];

  useEffect(() => {
    if (!target) return;
    setProtocol("openai-responses");
    setPrompt("Reply with exactly: VA_LOCAL_API_OK");
    setModel(`${target.agentId}-${target.profileId}-local-api`);
    setTestResult(null);
    setModelsStatus(null);
    void getAuthToken().then(setAuthToken).catch(() => setAuthToken(null));
    void apiFetch(`${localAgentBasePath(target)}/models`)
      .then(async (response) => {
        if (!response.ok) {
          setModelsStatus(t("Models endpoint returned {{status}}", {
            status: response.status,
          }));
          return;
        }
        const payload = await response.json().catch(() => null);
        const count = Array.isArray(payload?.data) ? payload.data.length : 0;
        setModelsStatus(t("Models endpoint ready · {{count}} model", { count }));
      })
      .catch((error) =>
        setModelsStatus(error instanceof Error ? error.message : String(error)),
      );
  }, [target, t]);

  const authHeaderValue = useMemo(() => {
    if (!authToken) return "Authorization: Bearer <token>";
    return `Authorization: Bearer ${authToken}`;
  }, [authToken]);

  if (!target) return null;

  async function copyValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1400);
    } catch {
      // Clipboard errors are non-fatal; users can still select visible text.
    }
  }

  async function runTest() {
    if (!target || !selectedProtocol) return;
    setTesting(true);
    setTestResult(null);
    try {
      const response = await apiFetch(`${basePath}/${selectedProtocol.endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vibearound-cwd": target.workspacePath,
        },
        body: JSON.stringify(testPayload(protocol, model, prompt)),
      });
      const rawText = await response.text();
      const payload = parseJson(rawText);
      setTestResult({
        ok: response.ok,
        status: response.status,
        text: response.ok
          ? extractResponseText(protocol, payload) || rawText
          : errorText(payload, rawText),
      });
    } catch (error) {
      setTestResult({
        ok: false,
        status: 0,
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!flex max-h-[calc(100vh-64px)] w-[min(840px,calc(100vw-32px))] max-w-[calc(100vw-32px)] flex-col overflow-hidden p-0 sm:max-w-[min(840px,calc(100vw-32px))]">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-primary" />
            {t("Local API")}
          </DialogTitle>
          <DialogDescription className="truncate text-xs">
            {target.agentLabel} · {target.profileLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4 [scrollbar-gutter:stable]">
          <section className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t("Supported protocols")}
              </span>
              {PROTOCOLS.map((item) => (
                <Badge
                  key={item.id}
                  variant="secondary"
                  className="border border-primary/25 bg-primary/10 text-primary"
                >
                  {item.shortLabel}
                </Badge>
              ))}
            </div>
            <CopyRow
              label={t("Base URL")}
              value={baseUrl}
              copied={copiedKey === "base"}
              onCopy={() => copyValue("base", baseUrl)}
            />
            <CopyRow
              label={t("Auth header")}
              value={maskAuthHeader(authHeaderValue)}
              copied={copiedKey === "auth"}
              onCopy={() => copyValue("auth", authHeaderValue)}
              icon={<KeyRound className="h-3.5 w-3.5" />}
            />
            <div className="grid gap-1 rounded-md border border-border/70 bg-muted/20 p-2">
              {PROTOCOLS.map((item) => (
                <CopyRow
                  key={item.id}
                  label={item.label}
                  value={`${baseUrl}/${item.endpoint}`}
                  copied={copiedKey === item.id}
                  onCopy={() =>
                    copyValue(item.id, `${baseUrl}/${item.endpoint}`)
                  }
                />
              ))}
              <CopyRow
                label={t("Models")}
                value={`${baseUrl}/models`}
                copied={copiedKey === "models"}
                onCopy={() => copyValue("models", `${baseUrl}/models`)}
              />
            </div>
            {modelsStatus && (
              <div className="text-[11px] text-muted-foreground">
                {modelsStatus}
              </div>
            )}
          </section>

          <section className="grid gap-3 rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <MessageSquare className="h-4 w-4 text-primary" />
                {t("Test message")}
              </div>
              <Tabs
                value={protocol}
                onValueChange={(value) => {
                  setProtocol(value as LocalApiProtocol);
                  setTestResult(null);
                }}
              >
                <TabsList className="h-8">
                  {PROTOCOLS.map((item) => (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      className="px-2 text-[11px]"
                    >
                      {item.shortLabel}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                <span>{t("Model")}</span>
                <Input
                  value={model}
                  onChange={(event) => setModel(event.currentTarget.value)}
                  className="h-8 font-mono text-xs"
                />
              </label>
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                <span>{t("Workspace")}</span>
                <Input
                  value={target.workspacePath}
                  readOnly
                  className="h-8 font-mono text-xs"
                />
              </label>
            </div>
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              <span>{t("Message")}</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                className="min-h-[88px] w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-[11px] text-muted-foreground">
                {t("Sessionless request · a fresh ACP turn is created for each test.")}
              </div>
              <Button
                type="button"
                size="sm"
                disabled={testing || !prompt.trim() || !model.trim()}
                onClick={() => void runTest()}
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {testing ? t("Testing…") : t("Send test")}
              </Button>
            </div>
            {testResult && (
              <div
                className={`grid gap-1 rounded-md border p-2 ${
                  testResult.ok
                    ? "border-emerald-500/25 bg-emerald-500/5"
                    : "border-destructive/25 bg-destructive/5"
                }`}
              >
                <div
                  className={`flex items-center gap-1.5 text-[11px] font-medium ${
                    testResult.ok ? "text-emerald-600" : "text-destructive"
                  }`}
                >
                  {testResult.ok ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5" />
                  )}
                  {t("HTTP {{status}}", { status: testResult.status })}
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono text-[11px] leading-5 text-foreground">
                  {testResult.text || t("Empty")}
                </pre>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function localAgentBasePath(target: LocalAgentApiTarget): string {
  return `/va/local-agent/${encodeURIComponent(target.agentId)}/${encodeURIComponent(
    target.profileId,
  )}/v1`;
}

function testPayload(protocol: LocalApiProtocol, model: string, prompt: string) {
  switch (protocol) {
    case "openai-chat":
      return {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      };
    case "anthropic":
      return {
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      };
    case "openai-responses":
    default:
      return { model, input: prompt, stream: false };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractResponseText(protocol: LocalApiProtocol, payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (protocol === "openai-chat") {
    const choice = asArray(record.choices)[0];
    const message = asRecord(asRecord(choice).message);
    return stringValue(message.content);
  }
  if (protocol === "anthropic") {
    return asArray(record.content)
      .map((part) => stringValue(asRecord(part).text))
      .filter(Boolean)
      .join("");
  }
  const outputText = stringValue(record.output_text);
  if (outputText) return outputText;
  return asArray(record.output)
    .flatMap((item) => asArray(asRecord(item).content))
    .map((part) => stringValue(asRecord(part).text))
    .filter(Boolean)
    .join("");
}

function errorText(payload: unknown, fallback: string): string {
  const error = asRecord(asRecord(payload).error);
  return stringValue(error.message) || fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function maskAuthHeader(value: string): string {
  const prefix = "Authorization: Bearer ";
  if (!value.startsWith(prefix)) return value;
  const token = value.slice(prefix.length);
  if (!token || token === "<token>") return value;
  if (token.length <= 18) return `${prefix}${token}`;
  return `${prefix}${token.slice(0, 8)}...${token.slice(-6)}`;
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
  icon,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  icon?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)_28px] items-center gap-2 rounded-md border border-border/70 bg-background px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="min-w-0 truncate font-mono text-[11px] text-foreground" title={value}>
        {value}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="h-6 w-6"
        aria-label={t("Copy")}
        title={t("Copy")}
        onClick={onCopy}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}
