"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

import { ExternalLinkSafetyModal } from "./ExternalLinkSafetyModal";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export function MarkdownRenderer({
  content,
  isStreaming = false,
  className,
}: MarkdownRendererProps) {
  return (
    <Streamdown
      className={[
        "prose prose-sm dark:prose-invert max-w-none text-sm leading-7",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_[data-streamdown='code-block']]:my-3",
        "[&_[data-streamdown='code-block']]:gap-0",
        "[&_[data-streamdown='code-block']]:overflow-hidden",
        "[&_[data-streamdown='code-block']]:rounded-md",
        "[&_[data-streamdown='code-block']]:border",
        "[&_[data-streamdown='code-block']]:border-border/70",
        "[&_[data-streamdown='code-block']]:bg-muted/20",
        "[&_[data-streamdown='code-block']]:p-0",
        "[&_[data-streamdown='code-block-header']]:h-8",
        "[&_[data-streamdown='code-block-header']]:border-b",
        "[&_[data-streamdown='code-block-header']]:border-border/60",
        "[&_[data-streamdown='code-block-header']]:bg-muted/25",
        "[&_[data-streamdown='code-block-header']]:px-3",
        "[&_[data-streamdown='code-block-header']_span]:ml-0",
        "[&_[data-streamdown='code-block'][data-language='text']_[data-streamdown='code-block-header']]:hidden",
        "[&_[data-streamdown='code-block'][data-language='']_[data-streamdown='code-block-header']]:hidden",
        "[&_[data-streamdown='code-block-body']]:rounded-none",
        "[&_[data-streamdown='code-block-body']]:border-0",
        "[&_[data-streamdown='code-block-body']]:bg-transparent",
        "[&_[data-streamdown='code-block-body']]:p-3",
        "[&_[data-streamdown='code-block-body']_pre]:m-0",
        "[&_[data-streamdown='code-block-body']_pre]:overflow-x-auto",
        "[&_[data-streamdown='code-block-body']_pre]:bg-transparent",
        "[&_[data-streamdown='code-block-body']_pre]:p-0",
        "[&_[data-streamdown='code-block-body']_code]:text-[13px]",
        "[&_[data-streamdown='code-block-body']_code]:leading-6",
        "[&_[data-streamdown='image-wrapper']]:mx-0",
        "[&_[data-streamdown='image-wrapper']]:block",
        "[&_[data-streamdown='image-wrapper']]:w-fit",
        "[&_[data-streamdown='image']]:object-left",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      plugins={{ cjk, code }}
      controls={{ code: false }}
      shikiTheme={["github-light", "github-dark"]}
      isAnimating={isStreaming}
      parseIncompleteMarkdown={true}
      linkSafety={{
        enabled: true,
        renderModal: (props) => <ExternalLinkSafetyModal {...props} />,
      }}
    >
      {content}
    </Streamdown>
  );
}
