"use client";

import { Link } from "lucide-react";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { proxiedFileUrl } from "./contentUtils";

type ResourceLinkBlock = Extract<ContentBlock, { type: "resource_link" }>;

export function ResourceLinkRenderer({ block }: { block: ResourceLinkBlock }) {
  const href = proxiedFileUrl(block.uri, {
    name: block.name,
    mimeType: block.mimeType,
  });
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex min-w-0 items-start gap-3 py-2 text-sm hover:text-foreground"
    >
      <Link className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">
          {block.title ?? block.name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{block.uri}</span>
        {block.description && (
          <span className="mt-1 block text-xs text-muted-foreground/80">
            {block.description}
          </span>
        )}
      </span>
    </a>
  );
}
