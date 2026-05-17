"use client";

import { useI18n } from "@va/i18n";
import { ContentBlockRenderer } from "./ContentBlockRenderer";
import { DiffRenderer } from "./DiffRenderer";
import { TerminalReferenceRenderer } from "./TerminalReferenceRenderer";
import type { ToolCallContent } from "@agentclientprotocol/sdk";

function ToolTextContent({ item }: { item: Extract<ToolCallContent, { type: "content" }> }) {
  const { t } = useI18n();
  if (item.content.type !== "text" || item.content.text.length <= 800) {
    return <ContentBlockRenderer block={item.content} role="assistant" />;
  }

  return (
    <details>
      <summary className="cursor-pointer font-mono text-xs text-muted-foreground">
        {t("Text output")}
      </summary>
      <div className="mt-2 max-h-64 overflow-auto rounded bg-background/70 p-3">
        <ContentBlockRenderer block={item.content} role="assistant" />
      </div>
    </details>
  );
}

export function ToolContentRenderer({ item }: { item: ToolCallContent }) {
  switch (item.type) {
    case "content":
      return <ToolTextContent item={item} />;
    case "diff":
      return <DiffRenderer diff={item} />;
    case "terminal":
      return <TerminalReferenceRenderer terminal={item} />;
  }
}
