"use client";

import { Loader2 } from "lucide-react";
import { useI18n } from "@va/i18n";
import { ContentBlockRenderer } from "./ContentBlockRenderer";
import type { ChatThoughtPart } from "../chatTypes";

export function ThoughtRenderer({ part }: { part: ChatThoughtPart }) {
  const { t } = useI18n();
  const hasContent = part.blocks.some(
    (block) => block.type !== "text" || block.text.trim(),
  );

  if (!hasContent) return null;

  return (
    <details className="py-2 text-muted-foreground">
      <summary className="flex cursor-pointer items-center gap-2 font-mono text-xs uppercase">
        {part.active && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
        {t("Thinking")}
      </summary>
      <div className="mt-2 space-y-2">
        {part.blocks.map((block, index) => (
          <ContentBlockRenderer
            key={`${block.type}-${index}`}
            block={block}
            role="assistant"
            isStreaming={part.active && index === part.blocks.length - 1}
          />
        ))}
      </div>
    </details>
  );
}
