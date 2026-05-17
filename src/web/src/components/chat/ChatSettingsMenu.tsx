import { Settings } from "lucide-react";
import type { WebVerboseSettings } from "@va/client";
import { useI18n } from "@va/i18n";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ChatSettingsMenuProps {
  settings: WebVerboseSettings;
  onChange: (patch: Partial<WebVerboseSettings>) => void;
}

export function ChatSettingsMenu({ settings, onChange }: ChatSettingsMenuProps) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          title={t("Chat settings")}
          aria-label={t("Chat settings")}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs">{t("Transcript")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={settings.show_thinking}
          onCheckedChange={(checked) =>
            onChange({ show_thinking: checked === true })
          }
        >
          {t("Show thinking")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={settings.show_tool_use}
          onCheckedChange={(checked) =>
            onChange({ show_tool_use: checked === true })
          }
        >
          {t("Show tools")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={settings.show_archived}
          onCheckedChange={(checked) =>
            onChange({ show_archived: checked === true })
          }
        >
          {t("Show archived")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
