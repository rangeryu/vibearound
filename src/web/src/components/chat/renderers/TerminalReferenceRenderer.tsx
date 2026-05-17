"use client";

import { Terminal } from "lucide-react";
import { useI18n } from "@va/i18n";
import type { ToolCallContent } from "@agentclientprotocol/sdk";

type TerminalContent = Extract<ToolCallContent, { type: "terminal" }>;

export function TerminalReferenceRenderer({
  terminal,
}: {
  terminal: TerminalContent;
}) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-2 py-2 font-mono text-xs text-muted-foreground">
      <Terminal className="h-3.5 w-3.5" />
      <span>{t("Terminal")}</span>
      <span className="truncate">{terminal.terminalId}</span>
    </div>
  );
}
