"use client";

import { MessageResponse } from "../MessageResponse";
import type { ChatMessage } from "../chatTypes";
import type { ContentBlock } from "@agentclientprotocol/sdk";

type TextBlock = Extract<ContentBlock, { type: "text" }>;

export function TextBlockRenderer({
  block,
  role,
  isStreaming,
}: {
  block: TextBlock;
  role: ChatMessage["role"];
  isStreaming?: boolean;
}) {
  return role === "user" ? (
    <p className="whitespace-pre-wrap text-sm leading-6">{block.text}</p>
  ) : (
    <MessageResponse content={block.text} isStreaming={isStreaming} />
  );
}
