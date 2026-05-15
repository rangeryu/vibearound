"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

import type { MessageResponseProps } from "./MessageResponse";

type MessageSegment =
  | { kind: "markdown"; content: string }
  | {
      kind: "directive";
      name: string;
      attrs: Record<string, string>;
      raw: string;
    };

const DIRECTIVE_LINE_RE = /^\s*::([A-Za-z][\w-]*)\{(.*)\}\s*$/;
const DIRECTIVE_ATTR_RE = /([A-Za-z_][\w-]*)="([^"]*)"/g;

function parseDirectiveAttrs(source: string) {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(DIRECTIVE_ATTR_RE)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function splitMessageSegments(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const markdownLines: string[] = [];
  let inFence = false;

  const flushMarkdown = () => {
    if (markdownLines.length === 0) return;
    segments.push({ kind: "markdown", content: markdownLines.join("\n") });
    markdownLines.length = 0;
  };

  for (const line of content.split("\n")) {
    const trimmedStart = line.trimStart();
    const fence = trimmedStart.startsWith("```") || trimmedStart.startsWith("~~~");
    if (!inFence) {
      const directive = DIRECTIVE_LINE_RE.exec(line);
      if (directive) {
        flushMarkdown();
        segments.push({
          kind: "directive",
          name: directive[1],
          attrs: parseDirectiveAttrs(directive[2]),
          raw: line,
        });
        continue;
      }
    }

    markdownLines.push(line);
    if (fence) inFence = !inFence;
  }

  flushMarkdown();
  return segments;
}

function basename(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]+/).filter(Boolean).pop() ?? path;
}

function shortPath(path: string) {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join("/") || path;
}

function directiveLabel(name: string) {
  switch (name) {
    case "git-stage":
      return "Staged changes";
    case "git-commit":
      return "Created commit";
    case "git-push":
      return "Pushed branch";
    case "git-create-branch":
      return "Created branch";
    case "git-create-pr":
      return "Created pull request";
    case "code-comment":
      return "Code comment";
    case "archive":
      return "Archived thread";
    default:
      return name.replace(/-/g, " ");
  }
}

function directiveDetail(segment: Extract<MessageSegment, { kind: "directive" }>) {
  const { attrs, name } = segment;
  if (attrs.title) return attrs.title;
  if (attrs.branch) return attrs.branch;
  if (attrs.url) return attrs.url;
  if (attrs.file) return basename(attrs.file);
  if (attrs.cwd && name.startsWith("git-")) return shortPath(attrs.cwd);
  if (attrs.reason) return attrs.reason;
  return "";
}

function DirectiveBlock({
  segment,
}: {
  segment: Extract<MessageSegment, { kind: "directive" }>;
}) {
  const detail = directiveDetail(segment);

  return (
    <div
      className="not-prose my-2 flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
      title={segment.raw}
    >
      <span className="shrink-0 font-mono uppercase tracking-wide text-primary/80">
        Codex
      </span>
      <span className="shrink-0 text-foreground/80">{directiveLabel(segment.name)}</span>
      {detail && (
        <span className="min-w-0 truncate font-mono text-muted-foreground/70">
          {detail}
        </span>
      )}
    </div>
  );
}

/** Heavy markdown/code renderer loaded only when assistant output is shown. */
export function MessageResponseStreamdown({
  content,
  isStreaming = false,
  className,
}: MessageResponseProps) {
  const segments = splitMessageSegments(content);

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "directive" ? (
          <DirectiveBlock key={`${segment.name}-${index}`} segment={segment} />
        ) : (
          <Streamdown
            key={`markdown-${index}`}
            className={[
              "prose prose-sm dark:prose-invert max-w-none text-sm",
              "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
              className ?? "",
            ]
              .filter(Boolean)
              .join(" ")}
            plugins={{ cjk, code }}
            shikiTheme={["github-light", "github-dark"]}
            isAnimating={isStreaming}
            parseIncompleteMarkdown={true}
          >
            {segment.content}
          </Streamdown>
        ),
      )}
    </>
  );
}
