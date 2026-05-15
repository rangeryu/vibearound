"use client";

import { FileAudio } from "lucide-react";
import { dataUrl } from "./contentUtils";
import type { ContentBlock } from "@agentclientprotocol/sdk";

type AudioBlock = Extract<ContentBlock, { type: "audio" }>;

export function AudioBlockRenderer({ block }: { block: AudioBlock }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <FileAudio className="h-3.5 w-3.5" />
        <span>{block.mimeType}</span>
      </div>
      <audio controls src={dataUrl(block.mimeType, block.data)} className="w-full" />
    </div>
  );
}
