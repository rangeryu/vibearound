"use client";

import type { ReactNode } from "react";
import { useI18n } from "@va/i18n";
import { ErrorBoundary, type ErrorFallbackProps } from "./ErrorBoundary";

function DashboardErrorFallback({ error, reset }: ErrorFallbackProps) {
  const { t } = useI18n();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-base font-semibold">{t("Dashboard crashed")}</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("Something went wrong while rendering the dashboard.")}
          </p>
        </div>
        <p className="max-h-32 overflow-auto rounded bg-muted/50 p-3 font-mono text-xs leading-5 text-muted-foreground">
          {error.message || t("Unknown error")}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
          >
            {t("Try again")}
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            {t("Reload")}
          </button>
        </div>
      </section>
    </main>
  );
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(props) => <DashboardErrorFallback {...props} />}
      onError={(error, errorInfo) => {
        console.error("[VibeAround] dashboard render error:", error, errorInfo);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
