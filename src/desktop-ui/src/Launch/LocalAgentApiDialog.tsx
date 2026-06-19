import { useEffect, useState } from "react";
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
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { API_BASE } from "@/lib/api";
import {
  LOCAL_API_PROTOCOLS,
  extractLocalAgentModels,
  extractLocalAgentResponseText,
  localAgentBasePath,
  localAgentErrorText,
  localAgentProtocolSpec,
  localAgentTestPayload,
  parseLocalAgentJson,
  type LocalAgentModel,
  type LocalAgentApiTarget,
  type LocalApiProtocol,
} from "./localAgentApi";
import { ModelIdCombobox } from "./ModelIdCombobox";

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
  const [protocol, setProtocol] =
    useState<LocalApiProtocol>("openai-responses");
  const [prompt, setPrompt] = useState("Reply with exactly: VA_LOCAL_API_OK");
  const [model, setModel] = useState("");
  const [modelOptions, setModelOptions] = useState<LocalAgentModel[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const basePath = target ? localAgentBasePath(target) : "";
  const baseUrl = target ? `${API_BASE}${basePath}` : "";
  const selectedProtocol = localAgentProtocolSpec(protocol);
  const endpointUrl = selectedProtocol ? `${baseUrl}/${selectedProtocol.endpoint}` : baseUrl;
  const modelsUrl = `${baseUrl}/models`;

  useEffect(() => {
    if (!target) return;
    setProtocol("openai-responses");
    setPrompt("Reply with exactly: VA_LOCAL_API_OK");
    setModel("");
    setModelOptions([]);
    setTestResult(null);
    void fetch(`${API_BASE}${localAgentBasePath(target)}/models`, {
      headers: {
        "x-vibearound-cwd": target.workspacePath,
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }
        const payload = await response.json().catch(() => null);
        const models = extractLocalAgentModels(payload);
        setModelOptions(models);
        setModel(models[0]?.id ?? target.agentId);
      })
      .catch((error) => {
        setModel(target.agentId);
        console.warn("[desktop-ui] local agent models fetch failed:", error);
      });
  }, [target, t]);

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
      const response = await fetch(`${API_BASE}${basePath}/${selectedProtocol.endpoint}`, {
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
        className="!flex max-h-[calc(100vh-64px)] w-[min(860px,calc(100vw-32px))] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(860px,calc(100vw-32px))]"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="shrink-0 px-6 pb-4 pt-6 pr-12">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Server className="h-4 w-4 text-primary" />
            {t("Local API")}
          </DialogTitle>
          <DialogDescription className="mt-2 truncate text-sm">
            {target.agentLabel} · {target.profileLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 [scrollbar-gutter:stable]">
          <section className="grid gap-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <Tabs
                value={protocol}
                onValueChange={(value) => {
                  setProtocol(value as LocalApiProtocol);
                  setTestResult(null);
                }}
              >
                <TabsList className="h-8">
                  {LOCAL_API_PROTOCOLS.map((item) => (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      className="px-3 text-xs"
                    >
                      {item.shortLabel}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <div className="grid gap-1 rounded-md border border-border/70 p-2">
              <div className="flex min-h-5 flex-wrap items-center gap-2">
                <div className="text-xs font-semibold">
                  {t("Manual configuration")}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t("Click a value to copy.")}
                </div>
              </div>
              <ManualField
                label={t("Base URL")}
                value={endpointUrl}
                copied={copiedKey === protocol}
                onCopy={() => copyValue(protocol, endpointUrl)}
              />
              <ManualField
                label={t("Models API")}
                value={modelsUrl}
                copied={copiedKey === "models"}
                onCopy={() => copyValue("models", modelsUrl)}
              />
              <ModelListField
                label={t("Models")}
                models={modelOptions}
                fallback={model || t("Loading…")}
                copiedKey={copiedKey}
                onCopy={(modelId) => copyValue(`model:${modelId}`, modelId)}
              />
            </div>

            <div className="grid gap-2 rounded-md border border-border/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  {t("Test message")}
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
                <div className="grid gap-1 text-[11px] text-muted-foreground">
                  <span>{t("Model")}</span>
                  <ModelIdCombobox
                    value={model}
                    options={modelOptions.map((option) => ({
                      id: option.id,
                      label: option.description,
                    }))}
                    onValueChange={setModel}
                    inputClassName="h-7 w-full font-mono text-xs"
                  />
                </div>
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
                  className="min-h-[64px] w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-xs text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              <div className="flex items-center justify-end gap-3">
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
            </div>
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
    <div className="grid grid-cols-[78px_minmax(0,1fr)] items-center gap-2">
      <div className="min-w-0 text-[11px] leading-5 text-muted-foreground">
        <span className="truncate">{label}</span>
      </div>
      <button
        type="button"
        className={`flex h-5 w-full min-w-0 items-center rounded px-1.5 text-left font-mono text-[11px] leading-5 transition-colors ${
          tone === "primary"
            ? "bg-primary/5 text-primary hover:bg-primary/10"
            : "bg-muted/35 text-foreground hover:bg-muted/60"
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
      </button>
    </div>
  );
}

function ModelListField({
  label,
  models,
  fallback,
  copiedKey,
  onCopy,
}: {
  label: string;
  models: LocalAgentModel[];
  fallback: string;
  copiedKey: string | null;
  onCopy: (modelId: string) => void;
}) {
  const { t } = useI18n();
  if (models.length === 0) {
    return (
      <div className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-2">
        <div className="min-w-0 text-[11px] leading-5 text-muted-foreground">
          <span className="truncate">{label}</span>
        </div>
        <div className="flex h-5 min-w-0 items-center rounded bg-primary/5 px-1.5 font-mono text-[11px] leading-5 text-primary">
          <span className="min-w-0 truncate">{fallback}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[78px_minmax(0,1fr)] items-start gap-2">
      <div className="min-w-0 text-[11px] leading-5 text-muted-foreground">
        <span className="truncate">{label}</span>
      </div>
      <div className="grid min-w-0 gap-1">
        {models.map((model) => {
          const description =
            model.description && model.description !== model.id
              ? model.description
              : model.displayName !== model.id
                ? model.displayName
                : "";
          return (
            <button
              key={model.id}
              type="button"
              className="grid min-h-5 w-full min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto] items-center gap-2 rounded bg-primary/5 px-1.5 text-left text-[11px] leading-5 transition-colors hover:bg-primary/10"
              aria-label={t("Copy")}
              title={t("Copy")}
              onClick={() => onCopy(model.id)}
            >
              <span className="min-w-0 truncate font-mono text-primary">
                {model.id}
              </span>
              {description && (
                <span className="min-w-0 truncate text-muted-foreground">
                  {description}
                </span>
              )}
              {!description && <span />}
              {copiedKey === `model:${model.id}` && (
                <span className="shrink-0 text-primary">{t("Copied")}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
