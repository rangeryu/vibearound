import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  MessageSquare,
  Send,
  Server,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_BASE, apiFetch, getAuthToken } from "@/lib/api";
import {
  LOCAL_API_PROTOCOLS,
  extractLocalAgentModelIds,
  extractLocalAgentResponseText,
  localAgentBasePath,
  localAgentErrorText,
  localAgentProtocolSpec,
  localAgentTestPayload,
  maskLocalApiAuthHeader,
  parseLocalAgentJson,
  type LocalAgentApiTarget,
  type LocalApiProtocol,
} from "./localAgentApi";

interface LocalAgentApiDialogProps {
  target: LocalAgentApiTarget | null;
  onClose: () => void;
}

interface TestResult {
  ok: boolean;
  status: number;
  text: string;
}

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
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const basePath = target ? localAgentBasePath(target) : "";
  const baseUrl = target ? `${API_BASE}${basePath}` : "";
  const selectedProtocol = localAgentProtocolSpec(protocol);
  const endpointUrl = selectedProtocol ? `${baseUrl}/${selectedProtocol.endpoint}` : baseUrl;
  const modelsUrl = `${baseUrl}/models`;
  const modelListValue =
    modelOptions.length > 0 ? modelOptions.join(", ") : model || t("Loading…");

  useEffect(() => {
    if (!target) return;
    setProtocol("openai-responses");
    setPrompt("Reply with exactly: VA_LOCAL_API_OK");
    setModel("");
    setModelOptions([]);
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
        const models = extractLocalAgentModelIds(payload);
        setModelOptions(models);
        setModel(models[0] ?? target.agentId);
        setModelsStatus(t("Models endpoint ready · {{count}} models", { count: models.length }));
      })
      .catch((error) => {
        setModel(target.agentId);
        setModelsStatus(error instanceof Error ? error.message : String(error));
      });
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
        body: JSON.stringify(localAgentTestPayload(protocol, model, prompt)),
      });
      const rawText = await response.text();
      const payload = parseLocalAgentJson(rawText);
      setTestResult({
        ok: response.ok,
        status: response.status,
        text: response.ok
          ? extractLocalAgentResponseText(protocol, payload) || rawText
          : localAgentErrorText(payload, rawText),
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
      <DialogContent
        className="!flex max-h-[calc(100vh-64px)] w-[min(760px,calc(100vw-32px))] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(760px,calc(100vw-32px))]"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-primary" />
            {t("Local API")}
          </DialogTitle>
          <DialogDescription className="truncate text-xs">
            {target.agentLabel} · {target.profileLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-5 py-3 [scrollbar-gutter:stable]">
          <Tabs
            value={protocol}
            onValueChange={(value) => {
              setProtocol(value as LocalApiProtocol);
              setTestResult(null);
            }}
          >
            <TabsList className="h-7">
              {LOCAL_API_PROTOCOLS.map((item) => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  className="px-2.5 text-[11px]"
                >
                  {item.shortLabel}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <section className="grid gap-2 rounded-md border border-border/70 bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-semibold">
                {t("Manual configuration")}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("Click a value to copy.")}
              </div>
            </div>
            <ManualField
              label={t("API URL")}
              value={endpointUrl}
              copied={copiedKey === protocol}
              onCopy={() => copyValue(protocol, endpointUrl)}
            />
            <ManualField
              label={t("Models")}
              value={modelListValue}
              copied={copiedKey === "model-list"}
              onCopy={() => copyValue("model-list", modelListValue)}
              tone="primary"
            />
            <ManualField
              label={t("Models API")}
              value={modelsUrl}
              copied={copiedKey === "models"}
              onCopy={() => copyValue("models", modelsUrl)}
            />
            <ManualField
              label={t("Auth header")}
              value={maskLocalApiAuthHeader(authHeaderValue)}
              copied={copiedKey === "auth"}
              onCopy={() => copyValue("auth", authHeaderValue)}
            />
            {modelsStatus && (
              <div className="text-[11px] text-muted-foreground">
                {modelsStatus}
              </div>
            )}
          </section>

          <section className="grid gap-2 rounded-md border border-border/70 bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
                {t("Test message")} · {selectedProtocol.shortLabel}
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                <span>{t("Model")}</span>
                {modelOptions.length > 0 ? (
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger size="sm" className="h-7 w-full font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map((modelId) => (
                        <SelectItem key={modelId} value={modelId} className="font-mono text-xs">
                          {modelId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={model}
                    onChange={(event) => setModel(event.currentTarget.value)}
                    className="h-7 font-mono text-xs"
                  />
                )}
              </label>
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                <span>{t("Workspace")}</span>
                <Input
                  value={target.workspacePath}
                  readOnly
                  className="h-7 font-mono text-xs"
                />
              </label>
            </div>
            <label className="grid gap-1 text-[11px] text-muted-foreground">
              <span>{t("Message")}</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                className="min-h-[72px] w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
            <div className="flex items-center justify-between gap-2">
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
      </DialogContent>
    </Dialog>
  );
}

function ManualField({
  label,
  value,
  copied,
  onCopy,
  tone = "default",
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  tone?: "default" | "primary";
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-3">
      <div className="min-w-0 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        className={`h-7 w-full min-w-0 justify-start rounded-md px-2 font-mono text-xs ${
          tone === "primary"
            ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
            : "hover:bg-muted"
        }`}
        aria-label={t("Copy")}
        title={t("Copy")}
        onClick={onCopy}
      >
        <span className="min-w-0 truncate">{value}</span>
        {copied && (
          <span className="ml-2 shrink-0 text-[11px] font-sans text-primary">
            {t("Copied")}
          </span>
        )}
      </Button>
    </div>
  );
}
