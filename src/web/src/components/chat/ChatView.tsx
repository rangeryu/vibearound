"use client";

import { useCallback, useEffect, useState } from "react";
import { getLaunchSessions, getProfiles } from "@/api/sessions";
import { agentIdToToolType, getAgentDisplayName } from "@/lib/agents";
import type { LaunchSessionInfo, ProfileLaunchOption } from "@va/client";
import { useI18n } from "@va/i18n";
import { ChatInput } from "./ChatInput";
import { ChatMessageList } from "./ChatMessageList";
import { PendingPermissions } from "./PendingPermissions";
import type { ChatSessionSelection } from "./chatTypes";
import { useWebChatConnection } from "./useWebChatConnection";

export function ChatView() {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string>("claude");
  const [profiles, setProfiles] = useState<ProfileLaunchOption[]>([]);
  const [profileSelections, setProfileSelections] = useState<Record<string, string | undefined>>(
    {},
  );
  const [launchSessions, setLaunchSessions] = useState<LaunchSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionSelections, setSessionSelections] = useState<Record<string, ChatSessionSelection>>(
    {},
  );

  const handleSocketAgentSelected = useCallback((agentId: string) => {
    setSelectedAgent(agentId);
  }, []);

  const {
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
  } = useWebChatConnection({ onAgentSelected: handleSocketAgentSelected });

  const toolType = agentIdToToolType(selectedAgent);
  const selectedAgentInfo = agents.find((agent) => agent.id === selectedAgent);
  const agentLabel = selectedAgentInfo?.name ?? getAgentDisplayName(selectedAgent);
  const selectedProfileId = profileSelections[selectedAgent];
  const sessionSelection = sessionSelections[selectedAgent] ?? { kind: "current" };
  const selectedLaunchSession =
    sessionSelection.kind === "resume"
      ? launchSessions.find((session) => session.session_id === sessionSelection.sessionId)
      : undefined;

  useEffect(() => {
    let cancelled = false;
    void getProfiles()
      .then((items) => {
        if (!cancelled) setProfiles(items);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[ChatView] failed to load profiles:", error);
          setProfiles([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedAgent) {
      setLaunchSessions([]);
      setSessionsLoading(false);
      return;
    }

    let cancelled = false;
    setSessionsLoading(true);
    setLaunchSessions([]);
    void getLaunchSessions(selectedAgent)
      .then((items) => {
        if (cancelled) return;
        setLaunchSessions(items);
        setSessionSelections((prev) => {
          const current = prev[selectedAgent];
          if (
            current?.kind === "resume" &&
            !items.some((item) => item.session_id === current.sessionId)
          ) {
            return { ...prev, [selectedAgent]: { kind: "current" } };
          }
          return prev;
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[ChatView] failed to load launch sessions:", error);
          setLaunchSessions([]);
        }
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAgent]);

  const handleLaunchChange = useCallback((agentId: string, profileId?: string) => {
    setSelectedAgent(agentId);
    setProfileSelections((prev) => {
      const next = { ...prev };
      if (profileId === undefined) {
        delete next[agentId];
      } else {
        next[agentId] = profileId;
      }
      return next;
    });
  }, []);

  const handleSessionChange = useCallback(
    (selection: ChatSessionSelection) => {
      setSessionSelections((prev) => ({ ...prev, [selectedAgent]: selection }));
    },
    [selectedAgent],
  );

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const sent = sendMessage({
      text,
      agentId: selectedAgent,
      profileId: selectedProfileId,
      sessionSelection,
      launchSession: selectedLaunchSession,
    });
    if (!sent) return;

    setInput("");
    if (sessionSelection.kind === "new") {
      setSessionSelections((prev) => ({ ...prev, [selectedAgent]: { kind: "current" } }));
    }
  }, [
    input,
    selectedAgent,
    selectedLaunchSession,
    selectedProfileId,
    sendMessage,
    sessionSelection,
  ]);

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

      <ChatMessageList messages={messages} streaming={streaming} agentLabel={agentLabel} />

      <PendingPermissions
        permissions={pendingPermissions}
        onRespond={sendPermissionResponse}
        onCancel={cancelPermissionRequest}
      />

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={stopStreaming}
        disabled={!connected}
        submitDisabled={streaming}
        isStreaming={streaming}
        placeholder={connected ? t("Message {{agent}}…", { agent: agentLabel }) : t("Connecting…")}
        targetLabel={agentLabel}
        targetTool={toolType}
        selectedAgentId={selectedAgent}
        agents={agents}
        profiles={profiles}
        selectedProfileId={selectedProfileId}
        onLaunchChange={handleLaunchChange}
        sessions={launchSessions}
        sessionsLoading={sessionsLoading}
        sessionSelection={sessionSelection}
        activeSessionId={meta.sessionId}
        onSessionChange={handleSessionChange}
      />
    </div>
  );
}
