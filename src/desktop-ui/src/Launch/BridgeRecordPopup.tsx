import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Copy, Radio, Trash2, Wifi, WifiOff } from "lucide-react";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { authedWsUrl } from "@/lib/api";

const MAX_RECORDS = 200;

type BridgeRecordPhase =
  | "start"
  | "bridgeRequest"
  | "serverResponse"
  | "bridgeResponse"
  | "error";

interface RecordedPayload {
  byteLength: number;
  truncated: boolean;
  text: string;
  json?: unknown;
}

interface BridgeRecordMetadata {
  profileId: string;
  routeScope?: string;
  manualScope?: string;
  targetApiType: string;
  clientProtocol: string;
  upstreamProtocol?: string;
  upstreamUrl?: string;
  stream?: boolean;
  model?: string;
  passthrough: boolean;
}

interface BridgeRecordEvent {
  recordId: number;
  requestId: string;
  phase: BridgeRecordPhase;
  timestampMs: number;
  metadata?: BridgeRecordMetadata;
  originalRequest?: RecordedPayload;
  bridgeRequest?: RecordedPayload;
  serverResponse?: RecordedPayload;
  bridgeResponse?: RecordedPayload;
  error?: string;
  status?: number;
}

interface BridgeRecordEntry {
  recordId: number;
  requestId: string;
  timestampMs: number;
  updatedAtMs: number;
  metadata?: BridgeRecordMetadata;
  originalRequest?: RecordedPayload;
  bridgeRequest?: RecordedPayload;
  serverResponse?: RecordedPayload;
  bridgeResponse?: RecordedPayload;
  serverStatus?: number;
  bridgeStatus?: number;
  errors: string[];
  phases: Set<BridgeRecordPhase>;
}

type PayloadTab =
  | "originalRequest"
  | "bridgeRequest"
  | "serverResponse"
  | "bridgeResponse";

export function BridgeRecordPopup({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [records, setRecords] = useState<BridgeRecordEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!open) {
      setRecords([]);
      setSelectedId(null);
      setConnected(false);
      setError(null);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    let disposed = false;
    const connect = async () => {
      try {
        const url = await authedWsUrl("/ws/bridge-recording");
        if (disposed) return;
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          setError(null);
        };
        ws.onmessage = (event) => {
          try {
            const frame = JSON.parse(event.data) as BridgeRecordEvent;
            setRecords((current) => mergeRecordEvent(current, frame));
            setSelectedId((current) => current ?? frame.recordId);
          } catch {
            // Ignore malformed frames from stale or interrupted sockets.
          }
        };
        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          if (!disposed) {
            reconnectTimerRef.current = setTimeout(() => void connect(), 1000);
          }
        };
        ws.onerror = () => {
          setError(t("WebSocket error"));
        };
      } catch (e) {
        setConnected(false);
        setError(e instanceof Error ? e.message : t("WebSocket error"));
      }
    };

    void connect();
    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [open, t]);

  const selected = useMemo(
    () => records.find((record) => record.recordId === selectedId) ?? records[0],
    [records, selectedId],
  );

  const dialogSize = {
    width: "min(1680px, calc(100vw - 8rem))",
    maxWidth: "calc(100vw - 8rem)",
    height: "calc(100vh - 8rem)",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex grid-rows-none flex-col gap-0 overflow-hidden p-0"
        style={dialogSize}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4 text-primary" />
                {t("Bridge recorder")}
              </DialogTitle>
              <DialogDescription className="mt-1 truncate text-xs">
                {connected ? t("Connected") : t("Disconnected")}
                {error ? ` · ${error}` : ""}
              </DialogDescription>
            </div>
            <div
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs",
                connected
                  ? "border-emerald-500/30 text-emerald-600"
                  : "border-border text-muted-foreground",
              )}
            >
              {connected ? (
                <Wifi className="h-3.5 w-3.5" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              {records.length}
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-border bg-muted/15">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
              <span className="text-xs font-medium text-muted-foreground">
                {t("Requests")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("Clear")}
                title={t("Clear")}
                onClick={() => {
                  setRecords([]);
                  setSelectedId(null);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
              {records.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {t("No records")}
                </div>
              ) : (
                records.map((record) => (
                  <button
                    key={record.recordId}
                    type="button"
                    className={cn(
                      "flex w-full min-w-0 flex-col gap-1 border-b border-border/70 px-3 py-2 text-left transition-colors",
                      selected?.recordId === record.recordId
                        ? "bg-background"
                        : "hover:bg-background/60",
                    )}
                    onClick={() => setSelectedId(record.recordId)}
                  >
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-medium">
                        {record.metadata?.profileId ?? record.requestId.slice(0, 8)}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {formatTime(record.timestampMs)}
                      </span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <span className="truncate">
                        {record.metadata?.clientProtocol ?? t("client")}
                      </span>
                      <span>-&gt;</span>
                      <span className="truncate">
                        {record.metadata?.upstreamProtocol ?? t("upstream")}
                      </span>
                      {record.metadata?.stream && <span>SSE</span>}
                    </span>
                    <span className="flex items-center gap-1">
                      {payloadPhases.map((phase) => (
                        <span
                          key={phase}
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            record.phases.has(phase)
                              ? "bg-primary"
                              : "bg-muted-foreground/25",
                          )}
                        />
                      ))}
                      {record.errors.length > 0 && (
                        <AlertCircle className="ml-1 h-3 w-3 text-destructive" />
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col">
            {selected ? (
              <RecordDetails record={selected} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                {t("No record selected")}
              </div>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecordDetails({ record }: { record: BridgeRecordEntry }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<PayloadTab>("originalRequest");
  const payload = payloadForTab(record, tab);

  useEffect(() => {
    if (!payloadForTab(record, tab)) {
      const first = payloadTabs.find((candidate) => payloadForTab(record, candidate));
      if (first) setTab(first);
    }
  }, [record, tab]);

  return (
    <>
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-foreground">
              {record.requestId}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span>{record.metadata?.targetApiType ?? t("Unknown target")}</span>
              {record.metadata?.upstreamUrl && (
                <span className="max-w-[900px] truncate font-mono">
                  {record.metadata.upstreamUrl}
                </span>
              )}
              {record.serverStatus && (
                <span>
                  {t("server {{status}}", { status: record.serverStatus })}
                </span>
              )}
              {record.bridgeStatus && (
                <span>
                  {t("bridge {{status}}", { status: record.bridgeStatus })}
                </span>
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!payload}
            onClick={() => {
              if (payload) void navigator.clipboard?.writeText(payloadText(payload));
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {t("Copy")}
          </Button>
        </div>
        {record.errors.length > 0 && (
          <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
            {record.errors.join(" · ")}
          </div>
        )}
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as PayloadTab)}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList className="mx-4 mt-3 h-8 w-fit rounded-md">
          {payloadTabs.map((value) => (
            <TabsTrigger key={value} value={value} className="h-7 text-xs">
              {payloadTabLabel(t, value)}
            </TabsTrigger>
          ))}
        </TabsList>
        {payloadTabs.map((value) => (
          <TabsContent
            key={value}
            value={value}
            className="mt-0 min-h-0 overflow-hidden px-4 pb-4 pt-3"
          >
            <PayloadViewer payload={payloadForTab(record, value)} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

function PayloadViewer({ payload }: { payload?: RecordedPayload }) {
  const { t } = useI18n();
  if (!payload) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-border bg-muted/20 text-xs text-muted-foreground">
        {t("Empty")}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3 text-[11px] text-muted-foreground">
        <span>{formatBytes(payload.byteLength)}</span>
        {payload.truncated && <span>{t("Truncated")}</span>}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-foreground [font-variant-ligatures:none]">
        {payloadText(payload)}
      </pre>
    </div>
  );
}

const payloadTabs: PayloadTab[] = [
  "originalRequest",
  "bridgeRequest",
  "serverResponse",
  "bridgeResponse",
];

const payloadPhases: BridgeRecordPhase[] = [
  "start",
  "bridgeRequest",
  "serverResponse",
  "bridgeResponse",
];

function payloadForTab(record: BridgeRecordEntry, tab: PayloadTab) {
  return record[tab];
}

function payloadTabLabel(t: (value: string) => string, tab: PayloadTab) {
  switch (tab) {
    case "originalRequest":
      return t("Original request");
    case "bridgeRequest":
      return t("Bridge request");
    case "serverResponse":
      return t("Server response");
    case "bridgeResponse":
      return t("Bridge response");
  }
}

function mergeRecordEvent(records: BridgeRecordEntry[], event: BridgeRecordEvent) {
  const next = records.map((record) => {
    if (record.recordId !== event.recordId) return record;
    return mergeIntoRecord(record, event);
  });
  if (!next.some((record) => record.recordId === event.recordId)) {
    next.push(mergeIntoRecord(newRecord(event), event));
  }
  next.sort((a, b) => a.timestampMs - b.timestampMs);
  return next.slice(-MAX_RECORDS);
}

function newRecord(event: BridgeRecordEvent): BridgeRecordEntry {
  return {
    recordId: event.recordId,
    requestId: event.requestId,
    timestampMs: event.timestampMs,
    updatedAtMs: event.timestampMs,
    errors: [],
    phases: new Set(),
  };
}

function mergeIntoRecord(
  record: BridgeRecordEntry,
  event: BridgeRecordEvent,
): BridgeRecordEntry {
  const phases = new Set(record.phases);
  phases.add(event.phase);
  return {
    ...record,
    requestId: event.requestId,
    updatedAtMs: event.timestampMs,
    metadata: event.metadata ?? record.metadata,
    originalRequest: event.originalRequest ?? record.originalRequest,
    bridgeRequest: event.bridgeRequest ?? record.bridgeRequest,
    serverResponse: event.serverResponse ?? record.serverResponse,
    bridgeResponse: event.bridgeResponse ?? record.bridgeResponse,
    serverStatus:
      event.phase === "serverResponse" && event.status
        ? event.status
        : record.serverStatus,
    bridgeStatus:
      event.phase === "bridgeResponse" && event.status
        ? event.status
        : record.bridgeStatus,
    errors: event.error ? [...record.errors, event.error] : record.errors,
    phases,
  };
}

function payloadText(payload: RecordedPayload) {
  if (payload.json !== undefined) {
    try {
      return JSON.stringify(payload.json, null, 2);
    } catch {
      return payload.text;
    }
  }
  return payload.text;
}

function formatTime(timestampMs: number) {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
