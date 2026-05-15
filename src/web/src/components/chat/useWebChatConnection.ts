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
  appendUserMessageChunk,
  clearStreamProgressMessage,
  setStreamProgressMessage,
} from "./chatMessageUpdates";

interface UseWebChatConnectionOptions {
  onAgentSelected?: (agentId: string, source: "config" | "system") => void;
}

interface SendChatMessageRequest {
  text: string;
  agentId: string;
  profileId?: string;
  workspacePath?: string;
  sessionSelection: ChatSessionSelection;
  launchSession?: LaunchSessionInfo;
}

interface ResumeChatSessionRequest {
  agentId: string;
  profileId?: string;
  launchSession: LaunchSessionInfo;
}

export interface ResumeReplayState {
  sessionId: string;
  title?: string;
}

function contentText(update: SessionNotification["update"]) {
  if (!("content" in update)) return "";
  const content = update.content;
  if (!content || Array.isArray(content) || typeof content !== "object") return "";
  if (!("type" in content) || content.type !== "text") return "";
  const text = "text" in content ? content.text : undefined;
  return typeof text === "string" ? text : "";
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
  const [resumeReplay, setResumeReplay] = useState<ResumeReplayState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const promptInFlightRef = useRef(false);
  const resumeReplayRef = useRef<ResumeReplayState | null>(null);
  const ignoredReplaySessionsRef = useRef<Set<string>>(new Set());
  const resumeReplayDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const updateResumeReplay = useCallback((next: ResumeReplayState | null) => {
    resumeReplayRef.current = next;
    setResumeReplay(next);
  }, []);

  const clearResumeReplayDoneTimer = useCallback(() => {
    if (!resumeReplayDoneTimerRef.current) return;
    clearTimeout(resumeReplayDoneTimerRef.current);
    resumeReplayDoneTimerRef.current = null;
  }, []);

  const finishResumeReplay = useCallback(
    (sessionId?: string) => {
      const current = resumeReplayRef.current;
      if (sessionId && current?.sessionId !== sessionId) return;
      clearResumeReplayDoneTimer();
      updateResumeReplay(null);
    },
    [clearResumeReplayDoneTimer, updateResumeReplay],
  );

  const scheduleResumeReplayDone = useCallback(
    (sessionId: string) => {
      clearResumeReplayDoneTimer();
      resumeReplayDoneTimerRef.current = setTimeout(() => {
        finishResumeReplay(sessionId);
      }, 700);
    },
    [clearResumeReplayDoneTimer, finishResumeReplay],
  );

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl("/ws/chat"));
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setStreaming(false);
      promptInFlightRef.current = false;
      setPendingPermissions([]);
      finishResumeReplay();
    };
    ws.onerror = () => {
      setConnected(false);
      setStreaming(false);
      promptInFlightRef.current = false;
      finishResumeReplay();
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
          onAgentSelected?.(parsed.default_agent, "config");
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
          const pendingResume = resumeReplayRef.current;
          if (!pendingResume && ignoredReplaySessionsRef.current.has(parsed.session_id)) {
            break;
          }
          if (pendingResume && pendingResume.sessionId !== parsed.session_id) {
            break;
          }
          setMeta((prev) => ({ ...prev, sessionId: parsed.session_id }));
          if (pendingResume?.sessionId === parsed.session_id) {
            scheduleResumeReplayDone(parsed.session_id);
          }
          break;
        }
        case "system_text": {
          appendStandaloneAssistant(parsed.text);
          finishResumeReplay();
          const agentId = switchedAgentId(parsed.text);
          if (agentId) {
            onAgentSelected?.(agentId, "system");
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
          finishResumeReplay();
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
      if (ignoredReplaySessionsRef.current.has(notif.sessionId)) {
        return;
      }
      const pendingResume = resumeReplayRef.current;
      if (pendingResume && notif.sessionId !== pendingResume.sessionId) {
        return;
      }
      const replaying = pendingResume?.sessionId === notif.sessionId;

      const update = notif.update;
      switch (update.sessionUpdate) {
        case "user_message_chunk": {
          appendUserMessage(contentText(update), update.messageId);
          if (replaying) scheduleResumeReplayDone(notif.sessionId);
          break;
        }
        case "agent_message_chunk": {
          appendToStreamAssistant(contentText(update), update.messageId);
          if (replaying) scheduleResumeReplayDone(notif.sessionId);
          break;
        }
        case "agent_thought_chunk": {
          if (replaying) {
            scheduleResumeReplayDone(notif.sessionId);
            break;
          }
          appendThinkingActivity(contentText(update));
          break;
        }
        case "tool_call":
        case "tool_call_update": {
          if (replaying) {
            scheduleResumeReplayDone(notif.sessionId);
            break;
          }
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
          if (replaying) scheduleResumeReplayDone(notif.sessionId);
          break;
      }
    }

    function appendStandaloneAssistant(text: string) {
      setMessages((prev) => appendStandaloneAssistantMessage(prev, text));
    }

    function appendUserMessage(text: string, messageId?: string | null) {
      setMessages((prev) => appendUserMessageChunk(prev, text, messageId));
    }

    function appendToStreamAssistant(text: string, messageId?: string | null) {
      setMessages((prev) => appendStreamAssistantMessage(prev, text, messageId));
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
      clearResumeReplayDoneTimer();
    };
  }, [
    clearResumeReplayDoneTimer,
    finishResumeReplay,
    onAgentSelected,
    scheduleResumeReplayDone,
    t,
  ]);

  const sendMessage = useCallback(
    ({
      text,
      agentId,
      profileId,
      workspacePath,
      sessionSelection,
      launchSession,
    }: SendChatMessageRequest) => {
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
          if (workspacePath) {
            payload.sessionWorkspace = workspacePath;
          }
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

  const clearConversationView = useCallback((options?: { abortReplay?: boolean }) => {
    const ws = wsRef.current;
    const abortedSessionId = resumeReplayRef.current?.sessionId;
    if (
      options?.abortReplay &&
      resumeReplayRef.current &&
      ws?.readyState === WebSocket.OPEN
    ) {
      try {
        ws.send(JSON.stringify({ type: "stop" }));
      } catch (error) {
        console.warn("[ChatView] failed to abort session replay:", error);
      }
    }
    if (options?.abortReplay && abortedSessionId) {
      ignoredReplaySessionsRef.current.add(abortedSessionId);
    }
    clearResumeReplayDoneTimer();
    promptInFlightRef.current = false;
    setStreaming(false);
    setPendingPermissions([]);
    updateResumeReplay(null);
    setMessages([]);
    setMeta((prev) => ({
      ...prev,
      sessionId: undefined,
      agentName: undefined,
      agentTitle: undefined,
      agentVersion: undefined,
    }));
  }, [clearResumeReplayDoneTimer, updateResumeReplay]);

  const resumeSession = useCallback(
    ({ agentId, profileId, launchSession }: ResumeChatSessionRequest) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;

      clearConversationView({ abortReplay: true });
      ignoredReplaySessionsRef.current.delete(launchSession.session_id);
      updateResumeReplay({
        sessionId: launchSession.session_id,
        title: launchSession.title,
      });
      setMeta((prev) => ({ ...prev, sessionId: launchSession.session_id }));

      try {
        const payload: Record<string, unknown> = {
          type: "resume_session",
          agent: agentId,
          sessionId: launchSession.session_id,
          sessionWorkspace: launchSession.workspace,
        };
        if (profileId !== undefined) {
          payload.profileId = profileId;
        }
        ws.send(JSON.stringify(payload));
        return true;
      } catch (error) {
        console.warn("[ChatView] failed to resume chat session:", error);
        updateResumeReplay(null);
        return false;
      }
    },
    [clearConversationView, updateResumeReplay],
  );

  const stopStreaming = useCallback(() => {
    const ws = wsRef.current;
    const abortedSessionId = resumeReplayRef.current?.sessionId;
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "stop" }));
      } catch (error) {
        console.warn("[ChatView] failed to stop chat message:", error);
      }
    }
    if (abortedSessionId) {
      ignoredReplaySessionsRef.current.add(abortedSessionId);
    }
    promptInFlightRef.current = false;
    setStreaming(false);
    updateResumeReplay(null);
  }, [updateResumeReplay]);

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
    resumeReplay,
    sendMessage,
    resumeSession,
    clearConversationView,
    stopStreaming,
    sendPermissionResponse,
    cancelPermissionRequest,
  };
}
