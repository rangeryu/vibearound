"use client";

import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LinkSafetyModalProps } from "streamdown";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";

export function ExternalLinkSafetyModal({
  isOpen,
  onClose,
  onConfirm,
  url,
}: LinkSafetyModalProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [url]);

  const handleConfirm = useCallback(() => {
    onConfirm();
    onClose();
  }, [onClose, onConfirm]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/55 p-4 backdrop-blur-sm"
      data-streamdown="link-safety-modal"
      onClick={onClose}
    >
      <div
        aria-modal="true"
        className="relative flex w-full max-w-2xl flex-col gap-5 rounded-xl border bg-background p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute right-4 top-4 cursor-pointer text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label={t("Close")}
          title={t("Close")}
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="flex items-start gap-3 pr-8">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ExternalLink className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold leading-7 text-foreground">
              {t("Open external link?")}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("You're about to visit an external website.")}
            </p>
          </div>
        </div>

        <div className="min-w-0 overflow-x-auto rounded-lg bg-muted/60 px-3 py-3 font-mono text-sm leading-6 text-foreground/90">
          <span className="whitespace-nowrap select-all">{url}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 cursor-pointer"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t("Copied") : t("Copy link")}
          </Button>
          <Button
            type="button"
            variant="solid"
            className="h-11 cursor-pointer"
            onClick={handleConfirm}
          >
            <ExternalLink className="h-4 w-4" />
            {t("Open link")}
          </Button>
        </div>
      </div>
    </div>
  );
}
