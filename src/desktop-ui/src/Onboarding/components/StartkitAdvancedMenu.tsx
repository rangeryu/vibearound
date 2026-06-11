import {
  Globe,
  HardDrive,
  SlidersHorizontal,
  TerminalSquare,
} from "lucide-react";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { StartkitManifestSummary } from "../types";

export function StartkitAdvancedMenu({
  sources,
  downloadSource,
  onDownloadSource,
  installLocation,
  onInstallLocation,
  shellPath,
  shellPathDisabled,
  onShellPath,
}: {
  sources: StartkitManifestSummary["sources"];
  downloadSource: string;
  onDownloadSource: (value: string) => void;
  installLocation: "managed" | "system";
  onInstallLocation: (value: "managed" | "system") => void;
  shellPath: boolean;
  shellPathDisabled: boolean;
  onShellPath: (checked: boolean) => void;
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
          <InstallLocationChooser
            value={installLocation}
            onChange={onInstallLocation}
            t={t}
          />
          <ShellPathChooser
            checked={shellPath}
            disabled={shellPathDisabled}
            onChange={onShellPath}
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
        {t("Node/npm source")}
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

function InstallLocationChooser({
  value,
  onChange,
  t,
}: {
  value: "managed" | "system";
  onChange: (value: "managed" | "system") => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const options: Array<{
    id: "managed" | "system";
    label: string;
    description: string;
  }> = [
    {
      id: "managed",
      label: "VibeAround npm",
      description: "Install CLI tools under .vibearound/npm.",
    },
    {
      id: "system",
      label: "System",
      description: "Use the user's global toolchain when available.",
    },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium">
        <HardDrive className="h-3.5 w-3.5 text-primary" />
        {t("Install location")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant="outline"
            className={cn(
              "h-auto min-h-9 flex-col items-start justify-start gap-0.5 px-2 py-1.5 text-left text-xs",
              value === option.id && "border-primary bg-primary/10 text-primary",
            )}
            onClick={() => onChange(option.id)}
          >
            <span className="font-medium">{t(option.label)}</span>
            <span className="text-[10px] leading-snug text-muted-foreground">
              {t(option.description)}
            </span>
          </Button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
        {t("Plugins always install under .vibearound/plugins.")}
      </p>
    </div>
  );
}

function ShellPathChooser({
  checked,
  disabled,
  onChange,
  t,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <div
      className={cn(
        "pt-1",
        disabled && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium">
            <TerminalSquare className="h-3.5 w-3.5 text-primary" />
            {t("Write shell PATH")}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {t("Terminal sessions can find managed Node, Codex, Claude, and helper tools.")}
          </p>
        </div>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
          aria-label={t("Write shell PATH")}
        />
      </div>
    </div>
  );
}
