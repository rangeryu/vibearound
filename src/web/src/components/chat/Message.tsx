"use client";

import type { HTMLAttributes } from "react";

export type MessageRole = "user" | "assistant";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: MessageRole;
};

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={`group flex w-full flex-col gap-2 ${
        from === "user" ? "is-user items-end" : "is-assistant items-stretch"
      } ${className ?? ""}`}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ children, className, ...props }: MessageContentProps) {
  return (
    <div
      className={`flex min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm ${className ?? ""}`}
      {...props}
    >
      {children}
    </div>
  );
}
