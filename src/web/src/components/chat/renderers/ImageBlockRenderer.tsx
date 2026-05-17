"use client";

import { Image as ImageIcon } from "lucide-react";
import { useI18n } from "@va/i18n";
import { dataUrl, fileNameFromUri, proxiedFileUrl } from "./contentUtils";
import type { ContentBlock } from "@agentclientprotocol/sdk";

type ImageBlock = Extract<ContentBlock, { type: "image" }>;

export function ImageBlockRenderer({ block }: { block: ImageBlock }) {
  const { t } = useI18n();
  const imageSrc = block.uri
    ? proxiedFileUrl(block.uri, {
        name: fileNameFromUri(block.uri),
        mimeType: block.mimeType,
        inline: true,
      })
    : dataUrl(block.mimeType, block.data);

  return (
    <figure className="overflow-hidden">
      <img
        src={imageSrc}
        alt={block.uri ? fileNameFromUri(block.uri) : t("Image")}
        className="max-h-[28rem] w-full object-contain"
        loading="lazy"
      />
      <figcaption className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <ImageIcon className="h-3.5 w-3.5" />
        <span className="truncate">{block.uri ?? block.mimeType}</span>
      </figcaption>
    </figure>
  );
}
