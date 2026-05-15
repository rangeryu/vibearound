"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";
import type { AgentInfo, ProfileLaunchOption } from "@va/client";
import { useI18n } from "@va/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ToolType } from "@/lib/terminal-types";
import { ChatLaunchSelector } from "./ChatLaunchSelector";

export type { ChatSessionSelection } from "./chatTypes";

const TEXTAREA_MAX_HEIGHT_PX = 128;
const TEXTAREA_MIN_HEIGHT_PX = 40;
const HERO_TEXTAREA_MIN_HEIGHT_PX = 72;

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
  showLaunchSelector?: boolean;
  variant?: "dock" | "hero";
  className?: string;
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
  agents = [],
  profiles = [],
  selectedProfileId,
  onAgentChange,
  onLaunchChange,
  showLaunchSelector = true,
  variant = "dock",
  className,
}: ChatInputProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const minHeight =
      variant === "hero" ? HERO_TEXTAREA_MIN_HEIGHT_PX : TEXTAREA_MIN_HEIGHT_PX;
    el.style.height = "auto";
    el.style.height = `${Math.max(
      minHeight,
      Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX),
    )}px`;
  }, [value, variant]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <div
      data-slot="chat-input"
      className={cn(
        variant === "hero" ? "bg-transparent p-0" : "border-t border-border bg-background p-4",
        className,
      )}
    >
      <div
        role="group"
        className={cn(
          "mx-auto flex max-w-4xl flex-col rounded-lg border border-border transition-[box-shadow,border-color] focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/30",
          variant === "hero"
            ? "min-h-[7rem] bg-background shadow-lg shadow-foreground/5"
            : "min-h-[2.5rem] bg-muted/30",
        )}
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
          className={cn(
            "max-h-32 resize-none overflow-y-auto border-0 bg-transparent text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 transition-[height] duration-200 ease-out",
            variant === "hero"
              ? "min-h-[4.5rem] px-4 py-3"
              : "min-h-[2.5rem] px-3 py-2",
          )}
          style={{ height: variant === "hero" ? "4.5rem" : "2.5rem" }}
        />
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-1.5",
            variant === "hero" ? "px-3 py-2" : "px-2 py-1",
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {showLaunchSelector ? (
              <ChatLaunchSelector
                targetLabel={targetLabel}
                targetTool={targetTool}
                selectedAgentId={selectedAgentId}
                agents={agents}
                profiles={profiles}
                selectedProfileId={selectedProfileId}
                onAgentChange={onAgentChange}
                onLaunchChange={onLaunchChange}
              />
            ) : (
              <span className="min-w-0 truncate px-1 text-xs font-medium text-muted-foreground">
                {targetLabel}
              </span>
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
