"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ContentBlock,
  Plan,
  SessionNotification,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import {
  ChatEventSchema,
  type AgentInfo,
  type LaunchSessionInfo,
} from "@va/client";
import { useI18n } from "@va/i18n";
import { getWebSocketUrl } from "@/lib/ws-url";
import type {
  ChatAttachment,
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
  appendPlanMessage,
  appendStandaloneAssistantMessage,
  appendStreamAssistantMessage,
  appendThinkingActivityMessage,
  appendToolActivityMessage,
  appendUserMessageChunk,
  clearStreamProgressMessage,
  mergeChatMessageSnapshots,
  setStreamProgressMessage,
  settleStreamActivitiesMessage,
} from "./chatMessageUpdates";
import {
  readCachedChatSession,
  writeCachedChatSession,
} from "./chatSessionCache";

interface UseWebChatConnectionOptions {
  onAgentSelected?: (agentId: string, source: "config" | "system") => void;
}

interface SendChatMessageRequest {
  text: string;
  attachments?: ChatAttachment[];
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

type MessageUpdate = (prev: ChatMessage[]) => ChatMessage[];

export interface ResumeReplayState {
  sessionId: string;
  title?: string;
  agentId?: string;
  workspace?: string;
  updatedAt?: number;
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
  const resumeRequestIdRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const replayMessageBufferRef = useRef<{
    sessionId: string;
    messages: ChatMessage[];
  } | null>(null);
  const ignoredReplaySessionsRef = useRef<Set<string>>(new Set());
  const resumeReplayDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const replayCacheContextRef = useRef<ResumeReplayState | null>(null);
  const replayCacheWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
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

  const clearReplayCacheWriteTimer = useCallback(() => {
    if (!replayCacheWriteTimerRef.current) return;
    clearTimeout(replayCacheWriteTimerRef.current);
    replayCacheWriteTimerRef.current = null;
  }, []);

  const clearReplayCacheContext = useCallback(() => {
    replayCacheContextRef.current = null;
    clearReplayCacheWriteTimer();
  }, [clearReplayCacheWriteTimer]);

  const cacheResumeReplay = useCallback((
    replay: ResumeReplayState,
    messagesToCache = messagesRef.current,
  ) => {
    if (!replay.agentId || !replay.workspace || replay.updatedAt === undefined) return;
    if (messagesToCache.length === 0) return;
    void writeCachedChatSession({
      agentId: replay.agentId,
      workspace: replay.workspace,
      sessionId: replay.sessionId,
      updatedAt: replay.updatedAt,
      messages: messagesToCache,
    }).catch((error) => {
      console.warn("[ChatView] failed to cache replayed session:", error);
    });
  }, []);

  const scheduleReplayCacheWrite = useCallback(
    (replay = replayCacheContextRef.current) => {
      if (!replay?.agentId || !replay.workspace || replay.updatedAt === undefined) {
        return;
      }
      if (messagesRef.current.length === 0) return;
      clearReplayCacheWriteTimer();
      replayCacheWriteTimerRef.current = setTimeout(() => {
        cacheResumeReplay(replay);
      }, 350);
    },
    [cacheResumeReplay, clearReplayCacheWriteTimer],
  );

  const applyMessageUpdate = useCallback((
    updater: MessageUpdate,
    replaySessionId?: string,
  ) => {
    const replayBuffer = replaySessionId ? replayMessageBufferRef.current : null;
    if (replayBuffer && replayBuffer.sessionId === replaySessionId) {
      replayBuffer.messages = updater(replayBuffer.messages);
      return;
    }
    setMessages(updater);
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    scheduleReplayCacheWrite();
  }, [messages, scheduleReplayCacheWrite]);

  const finishResumeReplay = useCallback(
    (sessionId?: string, options?: { cache?: boolean }) => {
      const current = resumeReplayRef.current;
      if (sessionId && current?.sessionId !== sessionId) return;
      if (current && options?.cache) {
        const replayBuffer = replayMessageBufferRef.current;
        if (replayBuffer?.sessionId === current.sessionId) {
          const replayedMessages = settleStreamActivitiesMessage(
            replayBuffer.messages,
          );
          replayMessageBufferRef.current = null;
          if (replayedMessages.length > 0) {
            const mergedMessages = mergeChatMessageSnapshots(
              messagesRef.current,
              replayedMessages,
            );
            messagesRef.current = mergedMessages;
            setMessages(mergedMessages);
            cacheResumeReplay(current, mergedMessages);
          }
          clearReplayCacheContext();
        } else {
          scheduleReplayCacheWrite(current);
        }
      } else if (!options?.cache) {
        replayMessageBufferRef.current = null;
        clearReplayCacheContext();
      }
      clearResumeReplayDoneTimer();
      updateResumeReplay(null);
    },
    [
      cacheResumeReplay,
      clearReplayCacheContext,
      clearResumeReplayDoneTimer,
      scheduleReplayCacheWrite,
      updateResumeReplay,
    ],
  );

  const scheduleResumeReplayDone = useCallback(
    (sessionId: string) => {
      clearResumeReplayDoneTimer();
      resumeReplayDoneTimerRef.current = setTimeout(() => {
        finishResumeReplay(sessionId, { cache: true });
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
      setMessages((prev) => settleStreamActivitiesMessage(prev));
      promptInFlightRef.current = false;
      setPendingPermissions([]);
      finishResumeReplay();
    };
    ws.onerror = () => {
      setConnected(false);
      setStreaming(false);
      setMessages((prev) => settleStreamActivitiesMessage(prev));
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
          settleStreamActivities();
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
      const replaySessionId = replaying ? notif.sessionId : undefined;

      const update = notif.update;
      switch (update.sessionUpdate) {
        case "user_message_chunk": {
          appendUserMessage(update.content, update.messageId, {
            forceNewMessage: replaying && !update.messageId,
          }, replaySessionId);
          if (replaying) scheduleResumeReplayDone(notif.sessionId);
          break;
        }
        case "agent_message_chunk": {
          appendToStreamAssistant(update.content, update.messageId, replaySessionId);
          if (replaying) scheduleResumeReplayDone(notif.sessionId);
          break;
        }
        case "agent_thought_chunk": {
          appendThinkingActivity(update.content, replaySessionId);
          if (replaying) scheduleResumeReplayDone(notif.sessionId);
          break;
        }
        case "tool_call":
        case "tool_call_update": {
          const title = toolActivityLabel(update);
          const status = toolActivityStatus(update);
          appendToolActivity(update, replaySessionId);
          if (status === "completed" || status === "failed") {
            clearStreamProgress(replaySessionId);
          } else {
            setStreamProgress(
              t("Using tool: {{tool}}…", { tool: title }),
              replaySessionId,
            );
          }
          if (replaying) scheduleResumeReplayDone(notif.sessionId);
          break;
        }
        case "plan": {
          appendPlan(update, replaySessionId);
          if (replaying) scheduleResumeReplayDone(notif.sessionId);
          break;
        }
        // Other ACP update variants (available_commands_update, mode/config,
        // session metadata, usage, etc.) update surrounding UI rather than the
        // visible transcript. Ignored here so future SDK additions don't crash
        // the handler.
        default:
          if (replaying) scheduleResumeReplayDone(notif.sessionId);
          break;
      }
    }

    function appendStandaloneAssistant(text: string, replaySessionId?: string) {
      applyMessageUpdate(
        (prev) => appendStandaloneAssistantMessage(prev, text),
        replaySessionId,
      );
    }

    function appendUserMessage(
      content: ContentBlock,
      messageId?: string | null,
      options?: { forceNewMessage?: boolean },
      replaySessionId?: string,
    ) {
      applyMessageUpdate(
        (prev) => appendUserMessageChunk(prev, content, messageId, options),
        replaySessionId,
      );
    }

    function appendToStreamAssistant(
      content: ContentBlock,
      messageId?: string | null,
      replaySessionId?: string,
      options?: { forceNewMessage?: boolean },
    ) {
      applyMessageUpdate(
        (prev) => appendStreamAssistantMessage(prev, content, messageId, options),
        replaySessionId,
      );
    }

    function appendThinkingActivity(content: ContentBlock, replaySessionId?: string) {
      applyMessageUpdate(
        (prev) => appendThinkingActivityMessage(prev, content, t("Thinking")),
        replaySessionId,
      );
    }

    function appendToolActivity(
      update: ToolCall | ToolCallUpdate,
      replaySessionId?: string,
    ) {
      applyMessageUpdate(
        (prev) => appendToolActivityMessage(prev, update),
        replaySessionId,
      );
    }

    function appendPlan(plan: Plan, replaySessionId?: string) {
      applyMessageUpdate((prev) => appendPlanMessage(prev, plan), replaySessionId);
    }

    function setStreamProgress(progress: string, replaySessionId?: string) {
      applyMessageUpdate(
        (prev) => setStreamProgressMessage(prev, progress, "tool"),
        replaySessionId,
      );
    }

    function clearStreamProgress(replaySessionId?: string) {
      applyMessageUpdate((prev) => clearStreamProgressMessage(prev), replaySessionId);
    }

    function settleStreamActivities(replaySessionId?: string) {
      applyMessageUpdate((prev) => settleStreamActivitiesMessage(prev), replaySessionId);
    }

    function appendErrorToStream(error: string) {
      applyMessageUpdate(
        (prev) => appendErrorToStreamMessage(prev, t("Error: {{error}}", { error })),
      );
    }

    return () => {
      ws.close();
      wsRef.current = null;
      clearResumeReplayDoneTimer();
      clearReplayCacheWriteTimer();
    };
  }, [
    applyMessageUpdate,
    clearReplayCacheWriteTimer,
    clearResumeReplayDoneTimer,
    finishResumeReplay,
    onAgentSelected,
    scheduleResumeReplayDone,
    t,
  ]);

  const sendMessage = useCallback(
    ({
      text,
      attachments = [],
      agentId,
      profileId,
      workspacePath,
      sessionSelection,
      launchSession,
    }: SendChatMessageRequest) => {
      const trimmed = text.trim();
      const ws = wsRef.current;
      if ((!trimmed && attachments.length === 0) || !ws || ws.readyState !== WebSocket.OPEN) {
        return false;
      }
      if (promptInFlightRef.current) return false;

      clearReplayCacheContext();
      promptInFlightRef.current = true;
      const messageId = createMessageId();
      const contentParts = messageContentBlocks(trimmed, attachments).map((block, index) => ({
        id: `user-content-${Date.now()}-${index}`,
        kind: "content" as const,
        block,
      }));
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed, parts: contentParts, messageId },
        { role: "assistant", content: "", mode: "stream" },
      ]);
      setStreaming(true);

      try {
        const payload: Record<string, unknown> = {
          type: "message",
          messageId,
          text: trimmed,
          agent: agentId,
        };
        if (attachments.length > 0) {
          payload.attachments = attachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            uri: attachment.uri,
          }));
        }
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
    [clearReplayCacheContext],
  );

  const clearConversationView = useCallback((options?: { abortReplay?: boolean }) => {
    const ws = wsRef.current;
    const replayContext = resumeReplayRef.current ?? replayCacheContextRef.current;
    const abortedSessionId = replayContext?.sessionId;
    if (options?.abortReplay) {
      resumeRequestIdRef.current += 1;
    }
    if (
      options?.abortReplay &&
      replayContext &&
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
    clearReplayCacheContext();
    replayMessageBufferRef.current = null;
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
  }, [clearReplayCacheContext, clearResumeReplayDoneTimer, updateResumeReplay]);

  const resumeSession = useCallback(
    ({ agentId, profileId, launchSession }: ResumeChatSessionRequest) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;

      clearConversationView({ abortReplay: true });
      const requestId = resumeRequestIdRef.current + 1;
      resumeRequestIdRef.current = requestId;
      ignoredReplaySessionsRef.current.delete(launchSession.session_id);
      const replay: ResumeReplayState = {
        sessionId: launchSession.session_id,
        title: launchSession.title,
        agentId,
        workspace: launchSession.workspace,
        updatedAt: launchSession.updated_at,
      };
      replayMessageBufferRef.current = {
        sessionId: launchSession.session_id,
        messages: [],
      };
      replayCacheContextRef.current = replay;
      updateResumeReplay(replay);
      setMeta((prev) => ({ ...prev, sessionId: launchSession.session_id }));

      void (async () => {
        try {
          const cachedMessages = await readCachedChatSession({
            agentId,
            workspace: launchSession.workspace,
            sessionId: launchSession.session_id,
            updatedAt: launchSession.updated_at,
          });
          if (resumeRequestIdRef.current !== requestId) return;
          if (cachedMessages) {
            const settledCachedMessages = settleStreamActivitiesMessage(cachedMessages);
            setMessages((prev) =>
              mergeChatMessageSnapshots(prev, settledCachedMessages),
            );
          }
        } catch (error) {
          console.warn("[ChatView] failed to read cached session:", error);
        }

        if (resumeRequestIdRef.current !== requestId) return;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          replayMessageBufferRef.current = null;
          clearReplayCacheContext();
          updateResumeReplay(null);
          return;
        }

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
        } catch (error) {
          console.warn("[ChatView] failed to resume chat session:", error);
          replayMessageBufferRef.current = null;
          clearReplayCacheContext();
          updateResumeReplay(null);
        }
      })();

      return true;
    },
    [clearConversationView, clearReplayCacheContext, updateResumeReplay],
  );

  const stopStreaming = useCallback(() => {
    const ws = wsRef.current;
    const replayContext = resumeReplayRef.current ?? replayCacheContextRef.current;
    const abortedSessionId = replayContext?.sessionId;
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
    setMessages((prev) => settleStreamActivitiesMessage(prev));
    replayMessageBufferRef.current = null;
    clearReplayCacheContext();
    updateResumeReplay(null);
  }, [clearReplayCacheContext, updateResumeReplay]);

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

function messageContentBlocks(
  text: string,
  attachments: ChatAttachment[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (text) blocks.push({ type: "text", text });
  blocks.push(
    ...attachments.map((attachment) => ({
      type: "resource_link" as const,
      name: attachment.name,
      title: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      uri: attachment.uri,
    })),
  );
  return blocks;
}
