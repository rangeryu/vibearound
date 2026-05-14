"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, History, PlusCircle, Send, Square } from "lucide-react";
import type { ToolType } from "@/lib/terminal-types";
import { getToolTheme } from "@/lib/terminal-types";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { useI18n } from "@va/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentInfo, LaunchSessionInfo, ProfileLaunchOption } from "@va/client";

const TEXTAREA_MAX_HEIGHT_PX = 128;
const DIRECT_PROFILE_ID = "direct";
const COMPACT_MENU_ITEM =
  "gap-1.5 px-1.5 py-1 text-xs leading-4 [&_svg:not([class*='size-'])]:size-3.5";
const COMPACT_SUB_TRIGGER =
  "gap-1.5 px-1.5 py-1 text-xs leading-4 [&_svg:not([class*='size-'])]:size-3.5";
const COMPACT_MENU_LABEL =
  "px-1.5 py-1 text-[10px] font-medium uppercase leading-3 text-muted-foreground";
const COMPACT_SEPARATOR = "-mx-0.5 my-0.5";

export type ChatSessionSelection =
  | { kind: "current" }
  | { kind: "new" }
  | { kind: "resume"; sessionId: string };

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  submitDisabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  placeholder?: string;
  /** Shown at bottom-left as "Chat with {targetLabel}", colored by targetTool. */
  targetLabel?: string;
  /** Tool type for accent color (claude/gemini/codex/generic). */
  targetTool?: ToolType;
  selectedAgentId?: string;
  /** Available agents for the selector dropdown. */
  agents?: AgentInfo[];
  profiles?: ProfileLaunchOption[];
  selectedProfileId?: string;
  /** Called when user picks a different agent from the dropdown. */
  onAgentChange?: (agentId: string) => void;
  onLaunchChange?: (agentId: string, profileId?: string) => void;
  /** Resumable sessions discovered for the selected agent/workspace. */
  sessions?: LaunchSessionInfo[];
  sessionsLoading?: boolean;
  sessionSelection?: ChatSessionSelection;
  activeSessionId?: string;
  onSessionChange?: (selection: ChatSessionSelection) => void;
  className?: string;
}

function shortSessionId(sessionId: string) {
  return sessionId.slice(0, 8);
}

function formatSessionUpdatedAt(updatedAt: number) {
  if (!updatedAt) return "";
  return new Date(updatedAt * 1000).toLocaleString();
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  submitDisabled = false,
  isStreaming = false,
  onStop,
  placeholder = "Message Claude…",
  targetLabel = "Claude Code",
  targetTool = "claude",
  selectedAgentId,
  agents,
  profiles = [],
  selectedProfileId,
  onAgentChange,
  onLaunchChange,
  sessions = [],
  sessionsLoading = false,
  sessionSelection = { kind: "current" },
  activeSessionId,
  onSessionChange,
  className,
}: ChatInputProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isComposing =
      isComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229;
    if (e.key === "Enter" && !e.shiftKey) {
      if (isComposing) return;
      e.preventDefault();
      if (!disabled && !submitDisabled && value.trim()) onSubmit();
    }
  };

  const canSend = !disabled && !submitDisabled && !!value.trim();
  const showStop = isStreaming && onStop;
  const appTheme = useTheme();
  const accentColor = getToolTheme(targetTool, appTheme).accent;

  const hasLaunchMenu = agents && agents.length > 0 && (onLaunchChange || onAgentChange);
  const currentAgentId = selectedAgentId ?? targetTool;
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const selectedRouteLabel =
    selectedProfileId === DIRECT_PROFILE_ID
      ? t("{{agent}} / Direct", { agent: targetLabel })
      : selectedProfile
        ? t("{{agent}} / {{profile}}", { agent: targetLabel, profile: selectedProfile.label })
        : targetLabel;
  const launchProfilesForAgent = (agentId: string) =>
    profiles.flatMap((profile) => {
      const target = profile.launch_targets.find((target) => target.id === agentId);
      return target ? [{ profile, usesProxy: Boolean(target.proxy_target_api_type) }] : [];
    });
  const chooseLaunch = (agentId: string, profileId?: string) => {
    if (onLaunchChange) {
      onLaunchChange(agentId, profileId);
    } else {
      onAgentChange?.(agentId);
    }
  };
  const selectedResumeSession =
    sessionSelection.kind === "resume"
      ? sessions.find((session) => session.session_id === sessionSelection.sessionId)
      : undefined;
  const sessionLabel =
    sessionsLoading
      ? t("Loading sessions…")
      : sessionSelection.kind === "new"
        ? t("New session")
        : selectedResumeSession
          ? selectedResumeSession.title
          : activeSessionId
            ? t("Current session")
            : t("New session");
  const activeSessionDetail = activeSessionId ? shortSessionId(activeSessionId) : t("No active session");
  const sessionDetail =
    selectedResumeSession
      ? `${selectedResumeSession.short_id} · ${formatSessionUpdatedAt(selectedResumeSession.updated_at)}`
      : activeSessionDetail;
  const showSessionSelector = Boolean(onSessionChange);

  return (
    <div
      data-slot="chat-input"
      className={`bg-background p-4 border-t border-border ${className ?? ""}`}
    >
      <div
        role="group"
        className="flex min-h-[2.5rem] flex-col rounded-lg border border-border bg-muted/30 transition-[box-shadow,border-color] focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/30"
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="min-h-[2.5rem] max-h-32 resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 transition-[height] duration-200 ease-out"
          style={{ height: "2.5rem" }}
        />
        <div className="flex shrink-0 items-center justify-between gap-1.5 px-2 py-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {hasLaunchMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs font-medium transition-colors hover:bg-muted/60"
                    title={t("Chat with {{agent}}", { agent: selectedRouteLabel })}
                  >
                    <span className="shrink-0 text-muted-foreground">{t("Chat with")}</span>
                    <span className="truncate" style={{ color: accentColor }}>
                      {selectedRouteLabel}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="max-h-[18rem] min-w-[210px] max-w-[min(22rem,calc(100vw-1rem))] overflow-y-auto p-0.5 text-xs"
                >
                  <DropdownMenuItem
                    className={COMPACT_MENU_ITEM}
                    onClick={() => chooseLaunch(currentAgentId, undefined)}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs">{t("Use configured default")}</div>
                      <div className="truncate text-[11px] leading-4 text-muted-foreground">
                        {targetLabel}
                      </div>
                    </div>
                    {!selectedProfileId && (
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {t("current")}
                      </span>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className={COMPACT_SEPARATOR} />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className={COMPACT_SUB_TRIGGER}>
                      {t("Launch without profile")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-[190px] p-0.5 text-xs">
                      {agents!.map((agent) => (
                        <DropdownMenuItem
                          key={agent.id}
                          onClick={() => chooseLaunch(agent.id, DIRECT_PROFILE_ID)}
                          className={`flex items-center justify-between ${COMPACT_MENU_ITEM}`}
                        >
                          <span className="truncate">{agent.name}</span>
                          {currentAgentId === agent.id && selectedProfileId === DIRECT_PROFILE_ID && (
                            <span className="text-[11px] text-muted-foreground">{t("current")}</span>
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator className={COMPACT_SEPARATOR} />
                  <DropdownMenuLabel className={COMPACT_MENU_LABEL}>{t("Profiles")}</DropdownMenuLabel>
                  {agents!.map((agent) => {
                    const entries = launchProfilesForAgent(agent.id);
                    if (!entries.length) return null;
                    return (
                      <DropdownMenuSub key={agent.id}>
                        <DropdownMenuSubTrigger className={COMPACT_SUB_TRIGGER}>
                          {agent.name}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="min-w-[220px] max-w-[22rem] p-0.5 text-xs">
                          {entries.map(({ profile, usesProxy }) => (
                            <DropdownMenuItem
                              key={profile.id}
                              onClick={() => chooseLaunch(agent.id, profile.id)}
                              className={`flex items-center justify-between gap-2 ${COMPACT_MENU_ITEM}`}
                            >
                              <span className="truncate">
                                {usesProxy
                                  ? t("{{profile}} (proxy)", { profile: profile.label })
                                  : profile.label}
                              </span>
                              {currentAgentId === agent.id && selectedProfileId === profile.id && (
                                <span className="text-[11px] text-muted-foreground">
                                  {t("current")}
                                </span>
                              )}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    );
                  })}
                  {!profiles.length && agents!.map((agent) => (
                    <DropdownMenuItem
                      key={agent.id}
                      onClick={() => chooseLaunch(agent.id, undefined)}
                      className={`flex items-center justify-between ${COMPACT_MENU_ITEM}`}
                    >
                      <span className="truncate">{agent.name}</span>
                      {agent.id === currentAgentId && (
                        <span className="text-[11px] text-muted-foreground">{t("current")}</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span
                className="flex min-w-0 items-center gap-1 truncate text-xs font-medium"
                title={t("Chat with {{agent}}", { agent: targetLabel })}
              >
                <span className="shrink-0 text-muted-foreground">{t("Chat with")}</span>
                <span className="truncate" style={{ color: accentColor }}>
                  {targetLabel}
                </span>
              </span>
            )}

            {showSessionSelector && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 max-w-[16rem] items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60"
                    title={`${sessionLabel} · ${sessionDetail}`}
                  >
                    <History className="h-3 w-3 shrink-0" />
                    <span className="truncate text-foreground/80">{sessionLabel}</span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="max-h-[15rem] min-w-[220px] max-w-[min(24rem,calc(100vw-1rem))] overflow-y-auto p-0.5 text-xs"
                >
                  <DropdownMenuItem
                    className={COMPACT_MENU_ITEM}
                    onClick={() => onSessionChange!({ kind: "current" })}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs">{t("Current session")}</div>
                      <div className="truncate text-[11px] leading-4 text-muted-foreground">
                        {activeSessionDetail}
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={COMPACT_MENU_ITEM}
                    onClick={() => onSessionChange!({ kind: "new" })}
                  >
                    <PlusCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{t("Start new session")}</span>
                  </DropdownMenuItem>
                  {sessions.length > 0 && <DropdownMenuSeparator className={COMPACT_SEPARATOR} />}
                  {sessions.map((session) => (
                    <DropdownMenuItem
                      key={session.session_id}
                      onClick={() =>
                        onSessionChange!({ kind: "resume", sessionId: session.session_id })
                      }
                      className={`items-start ${COMPACT_MENU_ITEM}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs">{session.title}</div>
                        <div className="truncate text-[11px] leading-4 text-muted-foreground">
                          {session.short_id} · {formatSessionUpdatedAt(session.updated_at)}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <Button
            type="button"
            size="icon"
            onClick={showStop ? onStop : onSubmit}
            disabled={!showStop && !canSend}
            className="h-8 w-8 shrink-0 rounded-full"
            aria-label={showStop ? t("Stop") : t("Send")}
          >
            {showStop ? (
              <Square className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
