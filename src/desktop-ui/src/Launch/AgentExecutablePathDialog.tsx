import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, RefreshCw } from "lucide-react";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  AgentExecutableCandidate,
  AgentExecutableResolution,
  AgentSummary,
} from "./api";
import type { AgentLaunchPreference } from "./types";

interface Props {
  agent: AgentSummary | null;
  preference?: AgentLaunchPreference;
  executableResolution?: AgentExecutableResolution | null;
  executableLoading?: boolean;
  busy: boolean;
  onClose: () => void;
  onSaveExecutablePath: (path: string | null) => Promise<void>;
  onRefreshExecutableResolution?: () => Promise<void>;
  onUpdateAgent?: (path: string) => Promise<void>;
}

type ClientOs = "macos" | "windows" | "linux";

function detectClientOs(): ClientOs {
  const platform = (
    typeof navigator === "undefined" ? "" : navigator.platform || ""
  ).toLowerCase();
  const ua = (
    typeof navigator === "undefined" ? "" : navigator.userAgent || ""
  ).toLowerCase();
  const source = `${platform} ${ua}`;
  if (source.includes("win")) return "windows";
  if (source.includes("mac")) return "macos";
  return "linux";
}

function configuredPath(
  preference?: AgentLaunchPreference,
  resolution?: AgentExecutableResolution | null,
): string {
  return (
    resolution?.configuredPath ??
    resolution?.selected?.path ??
    preference?.executable?.path ??
    preference?.executablePath ??
    ""
  );
}

function pathMatchesCandidate(
  path: string,
  candidate: AgentExecutableCandidate,
): boolean {
  const trimmed = path.trim();
  return (
    trimmed.length > 0 &&
    (trimmed === candidate.path || trimmed === (candidate.realpath ?? ""))
  );
}

function versionSummary(
  candidate: AgentExecutableCandidate,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  if (candidate.updateAvailable && candidate.latestVersion) {
    return t("New {{version}}", { version: candidate.latestVersion });
  }
  if (candidate.updateAvailable === false && candidate.latestVersion) {
    return t("Up to date");
  }
  if (candidate.latestVersion) {
    return t("Latest {{version}}", { version: candidate.latestVersion });
  }
  return null;
}

export function AgentExecutablePathDialog({
  agent,
  preference,
  executableResolution,
  executableLoading = false,
  busy,
  onClose,
  onSaveExecutablePath,
  onRefreshExecutableResolution,
  onUpdateAgent,
}: Props) {
  const { t } = useI18n();
  const initialPath = useMemo(
    () => configuredPath(preference, executableResolution),
    [preference, executableResolution],
  );
  const [executablePath, setExecutablePath] = useState(initialPath);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [updatingPath, setUpdatingPath] = useState<string | null>(null);

  useEffect(() => {
    setExecutablePath(initialPath);
    setSaveError(null);
    setUpdatingPath(null);
  }, [agent?.id, initialPath]);

  if (!agent) return null;

  const clientOs = detectClientOs();
  const isDesktopApp = agent.direct_only;
  const executableDirty = executablePath.trim() !== initialPath;

  async function save() {
    setSaveError(null);
    try {
      await onSaveExecutablePath(executablePath.trim() || null);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  }

  async function chooseExecutable() {
    const selected = await open({
      directory: false,
      multiple: false,
      title: isDesktopApp
        ? t("Choose desktop app executable")
        : t("Choose agent executable"),
      filters:
        clientOs === "windows"
          ? [{ name: "Executable", extensions: ["exe"] }]
          : undefined,
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (path) setExecutablePath(path);
  }

  async function updateAgent(path: string) {
    if (!onUpdateAgent) return;
    setSaveError(null);
    setUpdatingPath(path);
    try {
      await onUpdateAgent(path);
      await onRefreshExecutableResolution?.();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdatingPath(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!flex max-h-[calc(100vh-64px)] w-[min(660px,calc(100vw-28px))] max-w-[calc(100vw-28px)] flex-col overflow-hidden p-0 sm:max-w-[min(660px,calc(100vw-28px))]">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3 pr-12">
          <DialogTitle className="text-lg">
            {isDesktopApp
              ? t("{{agent}} app path", { agent: agent.display_name })
              : t("{{agent}} CLI launch path", { agent: agent.display_name })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isDesktopApp
              ? t("Choose the desktop app executable.")
              : t("Choose the CLI path used by Launch and ACP.")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5">
          <section className="space-y-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                {isDesktopApp ? t("Desktop app") : t("Executable")}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {isDesktopApp
                  ? t("Use a specific executable when auto-detect cannot find the app.")
                  : t("Choose the CLI path used by Launch and ACP.")}
              </div>
            </div>

            {!isDesktopApp && (
              <div className="space-y-2">
                {executableLoading ? (
                  <div className="text-[11px] text-muted-foreground">
                    {t("Checking path")}
                  </div>
                ) : executableResolution?.candidates.length ? (
                  executableResolution.candidates.map((candidate) => {
                    const selected = pathMatchesCandidate(
                      executablePath,
                      candidate,
                    );
                    const latest = versionSummary(candidate, t);
                    const updating = updatingPath === candidate.path;
                    return (
                      <div
                        key={`${candidate.source}:${candidate.path}`}
                        className={`flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
                          selected
                            ? "border-primary/45 bg-primary/10"
                            : "border-border bg-card hover:border-primary/30"
                        }`}
                      >
                        <button
                          type="button"
                          disabled={busy}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => setExecutablePath(candidate.path)}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-primary">
                            {selected ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <span className="h-2 w-2 rounded-full border border-muted-foreground/50" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-[11px] [font-variant-ligatures:none]">
                              {candidate.path}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {candidate.sourceLabel}
                              {candidate.version
                                ? ` · ${candidate.version}`
                                : ""}
                            </span>
                          </span>
                        </button>
                        {latest && (
                          <span
                            className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] ${
                              candidate.updateAvailable
                                ? "border-primary/35 bg-primary/10 text-primary"
                                : "border-border bg-muted/40 text-muted-foreground"
                            }`}
                          >
                            {latest}
                          </span>
                        )}
                        <Button
                          type="button"
                          variant={
                            candidate.updateAvailable ? "default" : "outline"
                          }
                          size="xs"
                          disabled={
                            busy ||
                            Boolean(updatingPath) ||
                            !candidate.updateCommand
                          }
                          className="h-7 shrink-0 px-2 text-xs"
                          title={candidate.updateCommand ?? t("No update command")}
                          onClick={() => void updateAgent(candidate.path)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {updating ? t("Updating") : t("Update")}
                        </Button>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    {t("No executable candidates found")}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-1.5">
              <Input
                value={executablePath}
                disabled={busy}
                placeholder={
                  clientOs === "windows"
                    ? "C:\\Path\\To\\Agent.exe"
                    : isDesktopApp
                      ? "/Applications/App.app/Contents/MacOS/App"
                      : "/opt/homebrew/bin/agent"
                }
                className="!h-8 min-h-8 max-h-8 font-mono !text-[11px] leading-4 placeholder:!text-[11px] md:!text-[11px] [font-variant-ligatures:none]"
                onChange={(event) => setExecutablePath(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                className="h-8 px-2.5 text-xs"
                onClick={() => void chooseExecutable()}
              >
                {t("Choose")}
              </Button>
            </div>
          </section>

          {saveError && (
            <div className="text-xs text-destructive">{saveError}</div>
          )}
        </div>

        <DialogFooter className="shrink-0 !flex-row items-center justify-between border-t border-border px-5 py-3 sm:justify-between">
          <div>
            {!isDesktopApp && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || executableLoading}
                className="h-8 px-2.5 text-xs"
                onClick={() => void onRefreshExecutableResolution?.()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("Scan")}
              </Button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onClose}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !executableDirty}
              onClick={() => void save()}
            >
              {t("Save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
