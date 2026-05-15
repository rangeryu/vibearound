"use client";

import { Image as ImageIcon } from "lucide-react";
import { useI18n } from "@va/i18n";
import { dataUrl, fileNameFromUri } from "./contentUtils";
import type { ContentBlock } from "@agentclientprotocol/sdk";

type ImageBlock = Extract<ContentBlock, { type: "image" }>;

export function ImageBlockRenderer({ block }: { block: ImageBlock }) {
  const { t } = useI18n();

  return (
    <figure className="overflow-hidden rounded-md border border-border/70 bg-muted/20">
      <img
        src={block.uri ?? dataUrl(block.mimeType, block.data)}
        alt={block.uri ? fileNameFromUri(block.uri) : t("Image")}
        className="max-h-[28rem] w-full object-contain"
        loading="lazy"
      />
      <figcaption className="flex items-center gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
        <ImageIcon className="h-3.5 w-3.5" />
        <span className="truncate">{block.uri ?? block.mimeType}</span>
      </figcaption>
    </figure>
  );
}
