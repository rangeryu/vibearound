import {
  Globe,
  SlidersHorizontal,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { StartkitManifestSummary } from "../types";

export function StartkitAdvancedMenu({
  sources,
  downloadSource,
  onDownloadSource,
}: {
  sources: StartkitManifestSummary["sources"];
  downloadSource: string;
  onDownloadSource: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={t("Settings")}
          aria-label={t("Settings")}
        >
          <SlidersHorizontal className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-3">
        <div className="space-y-4">
          <SourceChooser
            sources={sources}
            value={downloadSource}
            onChange={onDownloadSource}
            t={t}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SourceChooser({
  sources,
  value,
  onChange,
  t,
}: {
  sources: StartkitManifestSummary["sources"];
  value: string;
  onChange: (value: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const entries: Array<[string, { label: string }]> =
    Object.keys(sources).length > 0
      ? Object.entries(sources)
      : [
          ["global", { label: "Global" }],
          ["cn", { label: "China mirror" }],
        ];

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        <Globe className="h-3.5 w-3.5 text-primary" />
        {t("npm registry")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {entries.map(([id, source]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant="outline"
            className={cn(
              "justify-center text-xs",
              value === id && "border-primary bg-primary/10 text-primary",
            )}
            onClick={() => onChange(id)}
          >
            {t(source.label)}
          </Button>
        ))}
      </div>
    </div>
  );
}
