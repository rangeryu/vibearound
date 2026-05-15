"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, PanelLeftClose, PanelLeftOpen, Wifi, WifiOff } from "lucide-react";
import { getLaunchSessions, getProfiles } from "@/api/sessions";
import { agentIdToToolType, getAgentDisplayName } from "@/lib/agents";
import type { ChatRuntimeStatus } from "@/lib/dashboard-types";
import type { LaunchSessionInfo, ProfileLaunchOption } from "@va/client";
import { useI18n } from "@va/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatInput } from "./ChatInput";
import { ChatSessionSidebar } from "./ChatSessionSidebar";
import { ChatMessageList } from "./ChatMessageList";
import { NewChatHome } from "./NewChatHome";
import { PendingPermissions } from "./PendingPermissions";
import type { ChatSessionSelection } from "./chatTypes";
import { useWebChatConnection } from "./useWebChatConnection";

interface ChatViewProps {
  onStatusChange?: (status: ChatRuntimeStatus) => void;
}

export function ChatView({ onStatusChange }: ChatViewProps) {
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
  const [showSessionSidebar, setShowSessionSidebar] = useState(true);

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
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const sessionSelection = sessionSelections[selectedAgent] ?? { kind: "current" };
  const selectedLaunchSession =
    sessionSelection.kind === "resume"
      ? launchSessions.find((session) => session.session_id === sessionSelection.sessionId)
      : undefined;
  const chatStatus: ChatRuntimeStatus =
    pendingPermissions.length > 0
      ? "attention"
      : streaming
        ? "working"
        : connected
          ? "ready"
          : "connecting";
  const statusLabel =
    chatStatus === "attention"
      ? t("Agent needs input")
      : chatStatus === "working"
        ? t("Agent working")
        : chatStatus === "ready"
          ? t("Local agent ready")
          : t("Connecting to local agent");
  const statusIcon = !connected ? (
    <WifiOff className="h-3.5 w-3.5" />
  ) : streaming ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : (
    <Wifi className="h-3.5 w-3.5" />
  );
  const sessionLabel =
    sessionSelection.kind === "new"
      ? t("New session")
      : selectedLaunchSession
        ? selectedLaunchSession.title
        : meta.sessionId
          ? t("Current session")
          : t("New session");
  const routeLabel =
    selectedProfileId && selectedProfile
      ? t("{{agent}} / {{profile}}", {
          agent: agentLabel,
          profile: selectedProfile.label,
        })
      : agentLabel;
  const showNewChatHome = messages.length === 0 && sessionSelection.kind !== "resume";

  useEffect(() => {
    onStatusChange?.(chatStatus);
  }, [chatStatus, onStatusChange]);

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
    <div className="flex h-full overflow-hidden bg-background">
      {showSessionSidebar && (
        <ChatSessionSidebar
          sessions={launchSessions}
          sessionsLoading={sessionsLoading}
          sessionSelection={sessionSelection}
          onSessionChange={handleSessionChange}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowSessionSidebar((value) => !value)}
              className="hidden text-muted-foreground hover:text-foreground md:inline-flex"
              title={showSessionSidebar ? t("Hide sessions") : t("Show sessions")}
              aria-label={showSessionSidebar ? t("Hide sessions") : t("Show sessions")}
            >
              {showSessionSidebar ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </Button>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {routeLabel}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
                <span className="truncate">{sessionLabel}</span>
                {meta.sessionId && (
                  <span className="truncate text-muted-foreground/40">
                    {meta.sessionId.slice(0, 8)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px]",
              chatStatus === "attention"
                ? "text-amber-400"
                : chatStatus === "working"
                  ? "text-primary"
                  : connected
                    ? "text-emerald-400/80"
                    : "text-muted-foreground/60",
            )}
            title={statusLabel}
          >
            {statusIcon}
            <span className="hidden sm:inline">{statusLabel}</span>
          </div>
        </header>

        {showNewChatHome ? (
          <NewChatHome>
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              onStop={stopStreaming}
              disabled={!connected}
              submitDisabled={streaming}
              isStreaming={streaming}
              placeholder={
                connected ? t("Ask {{agent}} anything…", { agent: agentLabel }) : t("Connecting…")
              }
              targetLabel={agentLabel}
              targetTool={toolType}
              selectedAgentId={selectedAgent}
              agents={agents}
              profiles={profiles}
              selectedProfileId={selectedProfileId}
              onLaunchChange={handleLaunchChange}
              variant="hero"
            />
          </NewChatHome>
        ) : (
          <>
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
              placeholder={
                connected ? t("Message {{agent}}…", { agent: agentLabel }) : t("Connecting…")
              }
              targetLabel={agentLabel}
              targetTool={toolType}
              selectedAgentId={selectedAgent}
              agents={agents}
              profiles={profiles}
              selectedProfileId={selectedProfileId}
              onLaunchChange={handleLaunchChange}
            />
          </>
        )}
      </div>
    </div>
  );
}
