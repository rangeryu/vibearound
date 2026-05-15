"use client";

import { AudioBlockRenderer } from "./AudioBlockRenderer";
import { ImageBlockRenderer } from "./ImageBlockRenderer";
import { ResourceBlockRenderer } from "./ResourceBlockRenderer";
import { ResourceLinkRenderer } from "./ResourceLinkRenderer";
import { TextBlockRenderer } from "./TextBlockRenderer";
import type { ChatMessage } from "../chatTypes";
import type { ContentBlock } from "@agentclientprotocol/sdk";

interface ContentBlockRendererProps {
  block: ContentBlock;
  role: ChatMessage["role"];
  isStreaming?: boolean;
}

export function ContentBlockRenderer({
  block,
  role,
  isStreaming,
}: ContentBlockRendererProps) {
  switch (block.type) {
    case "text":
      return (
        <TextBlockRenderer
          block={block}
          role={role}
          isStreaming={isStreaming}
        />
      );
    case "image":
      return <ImageBlockRenderer block={block} />;
    case "audio":
      return <AudioBlockRenderer block={block} />;
    case "resource_link":
      return <ResourceLinkRenderer block={block} />;
    case "resource":
      return <ResourceBlockRenderer block={block} />;
  }
}
