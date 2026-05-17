"use client";

import type { ReactNode } from "react";
import { useI18n } from "@va/i18n";
import { ErrorBoundary, type ErrorFallbackProps } from "@/components/ErrorBoundary";

function MessageErrorFallback({ error, reset }: ErrorFallbackProps) {
  const { t } = useI18n();

  return (
    <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive/90">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t("Message render failed")}</span>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-destructive/25 px-2 py-1 text-xs hover:bg-destructive/10"
        >
          {t("Retry")}
        </button>
      </div>
      <p className="mt-1 break-words font-mono text-xs text-destructive/70">
        {error.message || t("Unknown error")}
      </p>
    </div>
  );
}

export function MessageRenderErrorBoundary({
  children,
  resetKey,
}: {
  children: ReactNode;
  resetKey: string;
}) {
  return (
    <ErrorBoundary
      fallback={(props) => <MessageErrorFallback {...props} />}
      resetKey={resetKey}
      onError={(error, errorInfo) => {
        console.error("[VibeAround] chat message render error:", error, errorInfo);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
