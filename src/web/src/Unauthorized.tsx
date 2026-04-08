/**
 * Unauthorized — dashboard auth gate.
 *
 * Rendered in place of <App /> when the SPA boots without a valid session
 * auth token. The HTML + JS bundle was still fetched (that path is public
 * by design so the browser can load the code that reads `?token=`), but
 * every API call would 401, so we show a clear, actionable message
 * instead of an empty broken-looking dashboard.
 *
 * Recovery paths the user has:
 *   1. Reopen the dashboard from the VibeAround tray or desktop window
 *      (the tray already appends `?token=` automatically).
 *   2. Paste a token directly if they have one on hand — stored in
 *      sessionStorage and the page reloads to retry.
 */

import { useState } from "react";

const STORAGE_KEY = "vibearound.auth.token";

export function Unauthorized() {
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = pasted.trim();
    if (!trimmed) {
      setError("Token is required.");
      return;
    }
    // 32 random bytes hex-encoded = 64 chars. Accept anything that
    // roughly looks like a token so we don't reject early on format,
    // but nudge the user if it's obviously wrong.
    if (!/^[0-9a-fA-F]{32,}$/.test(trimmed)) {
      setError("That doesn't look like a VibeAround auth token.");
      return;
    }
    window.sessionStorage.setItem(STORAGE_KEY, trimmed);
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-md space-y-6">
        {/* Lock badge */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight">
              Dashboard locked
            </h1>
            <p className="text-xs text-muted-foreground">
              This VibeAround instance requires a session token.
            </p>
          </div>
        </div>

        {/* Explanation */}
        <div className="rounded-lg border border-border bg-card/50 p-4 text-sm text-muted-foreground">
          <p>
            The dashboard page loaded, but no valid auth token was found in
            this browser tab. All data and WebSocket connections are gated
            by a per-session token that the VibeAround desktop app
            generates on every start.
          </p>
        </div>

        {/* Recovery: reopen from desktop */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Open from the desktop app
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground/90">
            <li>Click the VibeAround icon in your system tray or menu bar.</li>
            <li>
              Choose <span className="font-mono text-xs">Open Local Dashboard</span>.
            </li>
            <li>The dashboard will open in your browser with a valid token.</li>
          </ol>
        </div>

        {/* Recovery: paste token */}
        <details className="group rounded-lg border border-border bg-card/50">
          <summary className="cursor-pointer select-none px-4 py-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            I have a token — paste it
          </summary>
          <form onSubmit={submit} className="space-y-3 border-t border-border px-4 py-3">
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">
                Session auth token (from <span className="font-mono">~/.vibearound/auth.json</span>)
              </span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={pasted}
                onChange={(e) => {
                  setPasted(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="hex token…"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/60"
              />
            </label>
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
            <button
              type="submit"
              className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Unlock dashboard
            </button>
          </form>
        </details>

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground/60">
          VibeAround · session tokens regenerate on every app start
        </p>
      </div>
    </div>
  );
}
