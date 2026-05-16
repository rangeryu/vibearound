"use client";

import { useEffect, useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import { useI18n } from "@va/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatAttachment } from "./chatTypes";

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
  attachments?: ChatAttachment[];
  attachmentsUploading?: boolean;
  attachmentError?: string;
  onFilesSelected?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  placeholder?: string;
  /** Shown at bottom-left as the current chat target. */
  targetLabel?: string;
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
  attachments = [],
  attachmentsUploading = false,
  attachmentError,
  onFilesSelected,
  onRemoveAttachment,
  placeholder = "Message Claude…",
  targetLabel = "Claude Code",
  variant = "dock",
  className,
}: ChatInputProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      if (!disabled && !submitDisabled && canSend) onSubmit();
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      onFilesSelected?.(files);
    }
    event.target.value = "";
  };

  const canSend =
    !disabled &&
    !submitDisabled &&
    !attachmentsUploading &&
    (!!value.trim() || attachments.length > 0);
  const showStop = isStreaming && onStop;

  return (
    <div
      data-slot="chat-input"
      className={cn(
        variant === "hero" ? "bg-transparent p-0" : "bg-background px-4 pb-4 pt-2",
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
        {(attachments.length > 0 || attachmentsUploading || attachmentError) && (
          <div className="space-y-1.5 border-t border-border/60 px-3 py-2">
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-xs text-muted-foreground"
                  title={attachment.name}
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate text-foreground">
                    {attachment.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground/60">
                    {formatBytes(attachment.size)}
                  </span>
                  {onRemoveAttachment && (
                    <button
                      type="button"
                      className="ml-0.5 rounded-sm text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => onRemoveAttachment(attachment.id)}
                      aria-label={t("Remove attachment")}
                      title={t("Remove attachment")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {attachmentsUploading && (
                <span className="rounded-md border border-border/70 bg-background/70 px-2 py-1 text-xs text-muted-foreground">
                  {t("Uploading…")}
                </span>
              )}
            </div>
            {attachmentError && (
              <p className="text-xs text-destructive">{attachmentError}</p>
            )}
          </div>
        )}
        <div
          className={cn(
            "flex shrink-0 items-center justify-between gap-1.5",
            variant === "hero" ? "px-3 py-2" : "px-2 py-1",
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {onFilesSelected && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || attachmentsUploading}
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={t("Attach files")}
                  title={t("Attach files")}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              </>
            )}
            <span className="min-w-0 truncate px-1 text-xs font-medium text-muted-foreground">
              {targetLabel}
            </span>
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

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
