import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  Settings,
  StartkitChoices,
  StartkitCompleteEvent,
  StartkitItemReport,
  StartkitPlan,
  StartkitProgressEvent,
  StartkitScanReport,
} from "../types";

function pendingReportsFromPlan(
  plan: StartkitPlan,
  previous: StartkitItemReport[],
): StartkitItemReport[] {
  return plan.items.map(
    (item) =>
      previous.find((report) => report.id === item.id) ?? {
        id: item.id,
        label: item.label,
        group: item.group,
        category: item.category,
        status: "pending",
        severity: item.severity,
        actions: [],
        secret: item.secret,
        settingsKey: item.settingsKey,
      },
  );
}

function applyProgress(
  previous: StartkitItemReport[],
  payload: StartkitProgressEvent,
): StartkitItemReport[] {
  const next = [...previous];
  const index = next.findIndex((report) => report.id === payload.id);
  const base: StartkitItemReport =
    payload.report ??
    (index >= 0
      ? {
          ...next[index],
          status: payload.status,
          message: payload.message,
        }
      : {
          id: payload.id,
          label: payload.label,
          group: "startkit",
          category: "startkit",
          status: payload.status,
          message: payload.message,
          actions: [],
          secret: false,
        });
  if (index >= 0) next[index] = base;
  else next.push(base);
  return next;
}

function needsInstall(report: StartkitItemReport): boolean {
  return (
    report.status === "missing" ||
    report.status === "outdated" ||
    report.status === "broken" ||
    report.actions.includes("install")
  );
}

function reportsForInstallStart(
  reports: StartkitItemReport[],
): StartkitItemReport[] {
  return reports.map((report) =>
    needsInstall(report)
      ? {
          ...report,
          status: "running",
          message:
            report.status === "outdated"
              ? "Queued for update"
              : "Queued for install",
        }
      : report,
  );
}

function finalizeQueuedReports(
  reports: StartkitItemReport[],
  status: string,
): StartkitItemReport[] {
  return reports.map((report) => {
    if (
      report.status !== "running" ||
      (report.message !== "Queued for install" &&
        report.message !== "Queued for update")
    ) {
      return report;
    }

    if (status === "complete" || status === "needs_input") {
      return {
        ...report,
        status: "ok",
        message: "Installed",
        actions: [],
      };
    }

    if (status === "cancelled") {
      return {
        ...report,
        status: "skipped",
        message: "Cancelled",
      };
    }

    return {
      ...report,
      status: "error",
      message: "Install did not finish",
    };
  });
}

interface UseStartkitFlowResult {
  plan: StartkitPlan | null;
  reports: StartkitItemReport[];
  scanning: boolean;
  running: boolean;
  complete: boolean;
  finalStatus: string | null;
  error: string | null;
  reportById: Map<string, StartkitItemReport>;
  refreshPlan: (choices: StartkitChoices) => Promise<void>;
  scan: (settings: Settings, choices: StartkitChoices) => Promise<void>;
  start: (
    settings: Settings,
    choices: StartkitChoices,
    initialReports?: StartkitItemReport[],
  ) => Promise<void>;
  cancel: () => Promise<void>;
  finish: () => Promise<void>;
  reset: () => void;
}

export function useStartkitFlow(): UseStartkitFlowResult {
  const [plan, setPlan] = useState<StartkitPlan | null>(null);
  const [reports, setReports] = useState<StartkitItemReport[]>([]);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  const reportById = useMemo(
    () => new Map(reports.map((report) => [report.id, report])),
    [reports],
  );

  const refreshPlan = useCallback(async (choices: StartkitChoices) => {
    try {
      const nextPlan = await invoke<StartkitPlan>("startkit_plan", { choices });
      setPlan(nextPlan);
      setReports((previous) =>
        pendingReportsFromPlan(nextPlan, previous),
      );
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const scan = useCallback(async (settings: Settings, choices: StartkitChoices) => {
    setScanning(true);
    setError(null);
    setComplete(false);
    setFinalStatus(null);
    for (const unlisten of unlistenRefs.current) unlisten();
    unlistenRefs.current = [];
    let scanProgressUnlisten: UnlistenFn | null = null;

    try {
      scanProgressUnlisten = await listen<StartkitProgressEvent>(
        "startkit-progress",
        (event) => {
          setReports((previous) => applyProgress(previous, event.payload));
        },
      );
      unlistenRefs.current = [scanProgressUnlisten];

      const pendingPlan = await invoke<StartkitPlan>("startkit_plan", { choices });
      setPlan(pendingPlan);
      setReports((previous) =>
        pendingReportsFromPlan(pendingPlan, previous),
      );

      const report = await invoke<StartkitScanReport>("startkit_scan", {
        settings,
        choices,
      });
      setPlan(report.plan);
      setReports(report.reports);
    } catch (err) {
      setError(String(err));
    } finally {
      scanProgressUnlisten?.();
      unlistenRefs.current = unlistenRefs.current.filter(
        (unlisten) => unlisten !== scanProgressUnlisten,
      );
      setScanning(false);
    }
  }, []);

  const start = useCallback(async (
    settings: Settings,
    choices: StartkitChoices,
    initialReports?: StartkitItemReport[],
  ) => {
    setRunning(true);
    setComplete(false);
    setFinalStatus(null);
    setError(null);
    setReports((previous) =>
      reportsForInstallStart(
        initialReports && initialReports.length > 0 ? initialReports : previous,
      ),
    );

    for (const unlisten of unlistenRefs.current) unlisten();
    unlistenRefs.current = [];

    try {
      const unlistenProgress = await listen<StartkitProgressEvent>(
        "startkit-progress",
        (event) => {
          setReports((previous) => applyProgress(previous, event.payload));
        },
      );

      const unlistenComplete = await listen<StartkitCompleteEvent>(
        "startkit-complete",
        (event) => {
          setFinalStatus(event.payload.status);
          setReports((previous) =>
            finalizeQueuedReports(previous, event.payload.status),
          );
          setComplete(true);
          setRunning(false);
        },
      );

      unlistenRefs.current = [unlistenProgress, unlistenComplete];
      await invoke("start_startkit_install", { settings, choices });
    } catch (err) {
      setError(String(err));
      setRunning(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    await invoke("cancel_startkit_install");
    setRunning(false);
    setComplete(true);
    setFinalStatus("cancelled");
  }, []);

  const reset = useCallback(() => {
    if (running) return;
    for (const unlisten of unlistenRefs.current) unlisten();
    unlistenRefs.current = [];
    setPlan(null);
    setReports([]);
    setScanning(false);
    setComplete(false);
    setFinalStatus(null);
    setError(null);
  }, [running]);

  const finish = useCallback(async () => {
    for (const unlisten of unlistenRefs.current) unlisten();
    unlistenRefs.current = [];
    await invoke("finish_onboarding");
    window.location.replace("/");
  }, []);

  return {
    plan,
    reports,
    scanning,
    running,
    complete,
    finalStatus,
    error,
    reportById,
    refreshPlan,
    scan,
    start,
    cancel,
    finish,
    reset,
  };
}
