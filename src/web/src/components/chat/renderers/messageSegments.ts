export type MessageSegment =
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

export function splitMessageSegments(content: string): MessageSegment[] {
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

export function stripMessageDirectives(content: string) {
  return splitMessageSegments(content)
    .filter((segment): segment is Extract<MessageSegment, { kind: "markdown" }> =>
      segment.kind === "markdown"
    )
    .map((segment) => segment.content)
    .join("\n")
    .trim();
}
