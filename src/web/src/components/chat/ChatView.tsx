"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./Conversation";
import { Message, MessageContent } from "./Message";
import { MessageResponse } from "./MessageResponse";
import { ChatInput } from "./ChatInput";

import { getWebSocketUrl } from "@/lib/ws-url";
import { agentIdToToolType, getAgentDisplayName } from "@/lib/agents";
import { ChatEventSchema, type AgentInfo } from "@va/client";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { useI18n } from "@va/i18n";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  progress?: string;
  mode?: "standalone" | "stream";
};

type ChatMeta = {
  channelId?: string;
  sessionId?: string;
  agentTitle?: string;
  agentVersion?: string;
  agentName?: string;
};

type PendingPermission = {
  requestId: string;
  request: unknown;
};

type PermissionOptionView = {
  optionId: string;
  name: string;
  kind?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function permissionTitle(request: unknown) {
  const root = asRecord(request);
  const toolCall = asRecord(root?.toolCall);
  return (
    stringField(toolCall, "title") ??
    stringField(toolCall, "kind") ??
    "Permission requested"
  );
}

function permissionOptions(request: unknown): PermissionOptionView[] {
  const root = asRecord(request);
  const options = root && Array.isArray(root.options) ? root.options : [];
  return options.flatMap((option) => {
    const record = asRecord(option);
    const optionId = stringField(record, "optionId");
    return optionId
      ? [
          {
            optionId,
            name: stringField(record, "name") ?? optionId,
            kind: stringField(record, "kind"),
          },
        ]
      : [];
  });
}

function permissionButtonClass(kind?: string) {
  if (kind?.startsWith("reject")) {
    return "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15";
  }
  return "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15";
}

function switchedAgentId(text: string) {
  const match = /^Switched to ([A-Za-z0-9_-]+)\.$/.exec(text.trim());
  return match?.[1];
}

export function ChatView() {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [meta, setMeta] = useState<ChatMeta>({});

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("claude");
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const toolType = agentIdToToolType(selectedAgent);
  const selectedAgentInfo = agents.find((agent) => agent.id === selectedAgent);
  const agentLabel = selectedAgentInfo?.name ?? getAgentDisplayName(selectedAgent);

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl("/ws/chat"));
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setStreaming(false);
      setPendingPermissions([]);
    };
    ws.onerror = () => setConnected(false);

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;

      let parsed;
      try {
        parsed = ChatEventSchema.parse(JSON.parse(event.data));
      } catch (e) {
        console.warn("[ChatView] bad chat frame, dropping:", e);
        return;
      }

      switch (parsed.kind) {
        case "config": {
          setAgents(parsed.agents);
          setMeta((prev) => ({ ...prev, channelId: parsed.channel_id }));
          setSelectedAgent(parsed.default_agent);
          break;
        }
        case "agent_ready": {
          setMeta((prev) => ({
            ...prev,
            agentName: parsed.agent,
            agentVersion: parsed.version,
          }));
          break;
        }
        case "session_ready": {
          setMeta((prev) => ({ ...prev, sessionId: parsed.session_id }));
          break;
        }
        case "system_text": {
          appendStandaloneAssistant(parsed.text);
          const agentId = switchedAgentId(parsed.text);
          if (agentId) {
            setSelectedAgent(agentId);
            setMeta((prev) => ({
              ...prev,
              agentName: undefined,
              agentTitle: undefined,
              agentVersion: undefined,
              sessionId: undefined,
            }));
          }
          break;
        }
        case "error": {
          appendErrorToStream(parsed.error);
          setStreaming(false);
          break;
        }
        case "acp_notification": {
          handleAcpNotification(parsed.payload as SessionNotification);
          break;
        }
        case "command_menu":
          break;
        case "permission_request": {
          setPendingPermissions((prev) => [
            ...prev.filter((permission) => permission.requestId !== parsed.request_id),
            { requestId: parsed.request_id, request: parsed.request },
          ]);
          break;
        }
      }
    };

    function handleAcpNotification(notif: SessionNotification) {
      const update = notif.update;
      switch (update.sessionUpdate) {
        case "agent_message_chunk": {
          if (update.content.type === "text") {
            appendToStreamAssistant(update.content.text);
          }
          break;
        }
        case "agent_thought_chunk": {
          if (update.content.type === "text") {
            setStreamProgress(update.content.text);
          }
          break;
        }
        case "tool_call":
        case "tool_call_update": {
          const title = "title" in update ? update.title : undefined;
          const status = "status" in update ? update.status : undefined;
          if (status === "completed" || status === "failed") {
            clearStreamProgress();
          } else {
            setStreamProgress(t("Using tool: {{tool}}…", { tool: title ?? "tool" }));
          }
          break;
        }
        // Other ACP update variants (plan, available_commands_update, etc.)
        // are not yet surfaced in the web chat UI. Ignored rather than
        // erroring so future SDK additions don't crash the handler.
        default:
          break;
      }
    }

    function appendStandaloneAssistant(text: string) {
      if (!text) return;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant" && last.mode === "stream" && last.content === "" && !last.progress) {
          next.pop();
        }
        next.push({ role: "assistant", content: text, mode: "standalone" });
        return next;
      });
    }

    function appendToStreamAssistant(text: string) {
      if (!text) return;
      setMessages((prev) => {
        if (prev.length === 0) return [{ role: "assistant", content: text, mode: "stream" }];
        const last = prev[prev.length - 1];
        if (last.role !== "assistant" || last.mode !== "stream") {
          return [...prev, { role: "assistant", content: text, mode: "stream" }];
        }
        const next = [...prev];
        next[next.length - 1] = { ...last, content: last.content + text, progress: undefined, mode: "stream" };
        return next;
      });
    }

    function setStreamProgress(progress: string) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant" || last.mode !== "stream") {
          return [...prev, { role: "assistant", content: "", progress, mode: "stream" }];
        }
        const next = [...prev];
        next[next.length - 1] = { ...last, progress, mode: "stream" };
        return next;
      });
    }

    function clearStreamProgress() {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant" || last.mode !== "stream" || !last.progress) {
          return prev;
        }
        const next = [...prev];
        next[next.length - 1] = { ...last, progress: undefined, mode: "stream" };
        return next;
      });
    }

    function appendErrorToStream(error: string) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant" || last.mode !== "stream") {
          return [...prev, { role: "assistant", content: t("Error: {{error}}", { error }), mode: "stream" }];
        }
        const next = [...prev];
        next[next.length - 1] = {
          ...last,
          content: last.content + (last.content ? "\n\n" : "") + t("Error: {{error}}", { error }),
          progress: undefined,
          mode: "stream",
        };
        return next;
      });
    }

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [t]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "", mode: "stream" },
    ]);
    setStreaming(true);

    wsRef.current.send(JSON.stringify({ type: "message", text, agent: selectedAgent }));
  }, [input, selectedAgent]);

  const handleAgentChange = useCallback((agentId: string) => {
    setSelectedAgent(agentId);
  }, []);

  const sendPermissionResponse = useCallback(
    (requestId: string, optionId: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ type: "permission_response", requestId, optionId }));
      setPendingPermissions((prev) =>
        prev.filter((permission) => permission.requestId !== requestId),
      );
    },
    [],
  );

  const cancelPermissionRequest = useCallback((requestId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({ type: "permission_response", requestId, outcome: "cancelled" }),
    );
    setPendingPermissions((prev) =>
      prev.filter((permission) => permission.requestId !== requestId),
    );
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="border-b border-border/60 bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
          <span>{t("channel: web")}</span>
          <span>{t("chat: {{value}}", { value: meta.channelId ?? "-" })}</span>
          <span>{t("agent: {{value}}", { value: meta.agentTitle ?? meta.agentName ?? agentLabel })}</span>
          <span>{t("version: {{value}}", { value: meta.agentVersion ?? "-" })}</span>
          <span>{t("sessionId: {{value}}", { value: meta.sessionId ?? "-" })}</span>
        </div>
      </div>
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              title={t("Chat with {{agent}}", { agent: agentLabel })}
              description={t("Send a message to start.")}
            />
          ) : (
            messages.map((msg, i) => (
              <Message key={i} from={msg.role}>
                <MessageContent
                  className={
                    msg.role === "user"
                      ? "rounded-lg bg-primary/15 px-4 py-3 text-foreground"
                      : msg.mode === "standalone"
                        ? "rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-muted-foreground"
                        : "rounded-lg bg-muted/50 px-4 py-3 text-foreground"
                  }
                >
                  {msg.role === "user" ? (
                    <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                  ) : msg.mode === "standalone" ? (
                    <p className="whitespace-pre-wrap text-sm leading-7">{msg.content}</p>
                  ) : (
                    <>
                      <MessageResponse
                        content={msg.content}
                        isStreaming={streaming && i === messages.length - 1}
                      />
                      {msg.progress && (
                        <span className="text-xs text-muted-foreground/60 font-mono animate-pulse">
                          {msg.progress}
                        </span>
                      )}
                    </>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {pendingPermissions.length > 0 && (
        <div className="border-t border-border/60 bg-background px-4 py-3">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {pendingPermissions.map((permission) => {
              const options = permissionOptions(permission.request);
              return (
                <div
                  key={permission.requestId}
                  className="rounded-md border border-border/70 bg-muted/25 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {t("Permission request")}
                      </div>
                      <div className="truncate text-sm font-medium text-foreground">
                        {permissionTitle(permission.request)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {options.map((option) => (
                        <button
                          key={option.optionId}
                          type="button"
                          onClick={() =>
                            sendPermissionResponse(permission.requestId, option.optionId)
                          }
                          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${permissionButtonClass(option.kind)}`}
                        >
                          {option.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => cancelPermissionRequest(permission.requestId)}
                        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
                      >
                        {t("Cancel")}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={() => {
          void sendMessage();
        }}
        disabled={!connected}
        isStreaming={streaming}
        placeholder={connected ? t("Message {{agent}}…", { agent: agentLabel }) : t("Connecting…")}
        targetLabel={agentLabel}
        targetTool={toolType}
        agents={agents}
        onAgentChange={handleAgentChange}
      />
    </div>
  );
}
