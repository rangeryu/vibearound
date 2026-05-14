"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import {
  ChatEventSchema,
  type AgentInfo,
  type LaunchSessionInfo,
} from "@va/client";
import { useI18n } from "@va/i18n";
import { getWebSocketUrl } from "@/lib/ws-url";
import type {
  ChatMessage,
  ChatMeta,
  ChatSessionSelection,
  PendingPermission,
} from "./chatTypes";
import {
  createMessageId,
  switchedAgentId,
  toolActivityLabel,
  toolActivityStatus,
} from "./chatFrameUtils";
import {
  appendErrorToStreamMessage,
  appendStandaloneAssistantMessage,
  appendStreamAssistantMessage,
  appendThinkingActivityMessage,
  appendToolActivityMessage,
  clearStreamProgressMessage,
  setStreamProgressMessage,
} from "./chatMessageUpdates";

interface UseWebChatConnectionOptions {
  onAgentSelected?: (agentId: string) => void;
}

interface SendChatMessageRequest {
  text: string;
  agentId: string;
  profileId?: string;
  sessionSelection: ChatSessionSelection;
  launchSession?: LaunchSessionInfo;
}

export function useWebChatConnection({
  onAgentSelected,
}: UseWebChatConnectionOptions = {}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [meta, setMeta] = useState<ChatMeta>({});
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const promptInFlightRef = useRef(false);

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl("/ws/chat"));
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setStreaming(false);
      promptInFlightRef.current = false;
      setPendingPermissions([]);
    };
    ws.onerror = () => {
      setConnected(false);
      setStreaming(false);
      promptInFlightRef.current = false;
    };

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
          onAgentSelected?.(parsed.default_agent);
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
            onAgentSelected?.(agentId);
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
          promptInFlightRef.current = false;
          break;
        }
        case "prompt_done": {
          clearStreamProgress();
          setStreaming(false);
          promptInFlightRef.current = false;
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
            appendThinkingActivity(update.content.text);
          }
          break;
        }
        case "tool_call":
        case "tool_call_update": {
          const title = toolActivityLabel(update);
          const status = toolActivityStatus(update);
          appendToolActivity(update);
          if (status === "completed" || status === "failed") {
            clearStreamProgress();
          } else {
            setStreamProgress(t("Using tool: {{tool}}…", { tool: title }));
          }
          break;
        }
        // Other ACP update variants (plan, available_commands_update, etc.)
        // are not yet surfaced in the web chat UI. Ignored so future SDK
        // additions don't crash the handler.
        default:
          break;
      }
    }

    function appendStandaloneAssistant(text: string) {
      setMessages((prev) => appendStandaloneAssistantMessage(prev, text));
    }

    function appendToStreamAssistant(text: string) {
      setMessages((prev) => appendStreamAssistantMessage(prev, text));
    }

    function appendThinkingActivity(text: string) {
      setMessages((prev) => appendThinkingActivityMessage(prev, text, t("Thinking")));
    }

    function appendToolActivity(update: unknown) {
      setMessages((prev) => appendToolActivityMessage(prev, update));
    }

    function setStreamProgress(progress: string) {
      setMessages((prev) => setStreamProgressMessage(prev, progress));
    }

    function clearStreamProgress() {
      setMessages((prev) => clearStreamProgressMessage(prev));
    }

    function appendErrorToStream(error: string) {
      setMessages((prev) =>
        appendErrorToStreamMessage(prev, t("Error: {{error}}", { error })),
      );
    }

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [onAgentSelected, t]);

  const sendMessage = useCallback(
    ({ text, agentId, profileId, sessionSelection, launchSession }: SendChatMessageRequest) => {
      const trimmed = text.trim();
      const ws = wsRef.current;
      if (!trimmed || !ws || ws.readyState !== WebSocket.OPEN) return false;
      if (promptInFlightRef.current) return false;

      promptInFlightRef.current = true;
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "", mode: "stream" },
      ]);
      setStreaming(true);

      try {
        const payload: Record<string, unknown> = {
          type: "message",
          messageId: createMessageId(),
          text: trimmed,
          agent: agentId,
        };
        if (profileId !== undefined) {
          payload.profileId = profileId;
        }
        if (sessionSelection.kind === "new") {
          payload.sessionAction = "new";
        } else if (launchSession) {
          payload.sessionAction = "resume";
          payload.sessionId = launchSession.session_id;
          payload.sessionWorkspace = launchSession.workspace;
        }
        ws.send(JSON.stringify(payload));
        return true;
      } catch (error) {
        console.warn("[ChatView] failed to send chat message:", error);
        promptInFlightRef.current = false;
        setStreaming(false);
        setMessages((prev) => prev.slice(0, -2));
        return false;
      }
    },
    [],
  );

  const stopStreaming = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "stop" }));
      } catch (error) {
        console.warn("[ChatView] failed to stop chat message:", error);
      }
    }
    promptInFlightRef.current = false;
    setStreaming(false);
  }, []);

  const sendPermissionResponse = useCallback((requestId: string, optionId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "permission_response", requestId, optionId }));
    setPendingPermissions((prev) =>
      prev.filter((permission) => permission.requestId !== requestId),
    );
  }, []);

  const cancelPermissionRequest = useCallback((requestId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({ type: "permission_response", requestId, outcome: "cancelled" }),
    );
    setPendingPermissions((prev) =>
      prev.filter((permission) => permission.requestId !== requestId),
    );
  }, []);

  return {
    messages,
    connected,
    streaming,
    meta,
    agents,
    pendingPermissions,
    sendMessage,
    stopStreaming,
    sendPermissionResponse,
    cancelPermissionRequest,
  };
}
