"use client";

import type { MessageSegment } from "./messageSegments";

type DirectiveSegment = Extract<MessageSegment, { kind: "directive" }>;

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

function directiveDetail(segment: DirectiveSegment) {
  const { attrs, name } = segment;
  if (attrs.title) return attrs.title;
  if (attrs.branch) return attrs.branch;
  if (attrs.url) return attrs.url;
  if (attrs.file) return basename(attrs.file);
  if (attrs.cwd && name.startsWith("git-")) return shortPath(attrs.cwd);
  if (attrs.reason) return attrs.reason;
  return "";
}

export function DirectiveRenderer({ segment }: { segment: DirectiveSegment }) {
  const detail = directiveDetail(segment);

  return (
    <div
      className="not-prose my-2 flex min-w-0 items-center gap-2 py-2 text-xs text-muted-foreground"
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
