import { useEffect, useState } from "react";
import { useI18n } from "@va/i18n";

import { openExternalUrl } from "./lib/api";
import { checkForUpdate, type UpdateReleaseInfo } from "./lib/update";

export function UpdateIndicator() {
  const { t } = useI18n();
  const [release, setRelease] = useState<UpdateReleaseInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate().then((result) => {
      if (cancelled || result.state !== "updateAvailable") return;
      setRelease(result.release);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!release) return null;

  const url = release.downloadUrl ?? release.htmlUrl;
  const label = t("Update");
  const title = t("Update to VibeAround {{version}}", {
    version: release.latestVersion,
  });

  return (
    <button
      type="button"
      className="cursor-pointer font-medium text-[10px] text-primary underline-offset-2 hover:underline"
      title={title}
      aria-label={title}
      onClick={() => void openExternalUrl(url)}
    >
      {label}
    </button>
  );
}
