import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@va/i18n";

type ManagedPluginStatus = "ok" | "missing" | "outdated";

type ManagedPluginSummary = {
  category: "im" | "acp" | "search";
  id: string;
  name: string;
  status: ManagedPluginStatus;
  version?: string;
  latestVersion?: string;
};

export function PluginUpdateIndicator({
  onOpenPlugins,
}: {
  onOpenPlugins: () => void;
}) {
  const { t } = useI18n();
  const [outdatedPlugins, setOutdatedPlugins] = useState<
    ManagedPluginSummary[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    void invoke<ManagedPluginSummary[]>("refresh_managed_plugins")
      .then((plugins) => {
        if (cancelled) return;
        setOutdatedPlugins(
          plugins.filter((plugin) => plugin.status === "outdated"),
        );
      })
      .catch((error) => {
        console.warn("[desktop-ui] plugin update check failed:", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const title = useMemo(() => {
    if (outdatedPlugins.length === 0) return "";
    const names = outdatedPlugins.map((plugin) => {
      const latest = plugin.latestVersion ? ` ${plugin.latestVersion}` : "";
      return `${plugin.name}${latest}`;
    });
    return t("Plugin updates available: {{plugins}}", {
      plugins: names.join(", "),
    });
  }, [outdatedPlugins, t]);

  if (outdatedPlugins.length === 0) return null;

  const label =
    outdatedPlugins.length === 1
      ? t("Plugin update")
      : t("Plugin updates {{count}}", { count: outdatedPlugins.length });

  return (
    <button
      type="button"
      className="cursor-pointer font-medium text-[10px] text-primary underline-offset-2 hover:underline"
      title={title}
      aria-label={title}
      onClick={onOpenPlugins}
    >
      {label}
    </button>
  );
}
