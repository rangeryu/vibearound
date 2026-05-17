export type DiffLine = {
  kind: "context" | "added" | "removed";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

const MAX_LCS_CELLS = 200_000;

export function splitDiffLines(text: string | null | undefined) {
  if (!text) return [];
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}

export function diffLineStats(lines: DiffLine[]) {
  return lines.reduce(
    (stats, line) => {
      if (line.kind === "added") stats.added += 1;
      if (line.kind === "removed") stats.removed += 1;
      return stats;
    },
    { added: 0, removed: 0 },
  );
}

export function buildLineDiff(
  oldText: string | null | undefined,
  newText: string,
): DiffLine[] {
  const oldLines = splitDiffLines(oldText);
  const newLines = splitDiffLines(newText);

  if (oldText === null || oldText === undefined) {
    return newLines.map((text, index) => ({
      kind: "added",
      oldLine: null,
      newLine: index + 1,
      text,
    }));
  }

  if (oldLines.length * newLines.length > MAX_LCS_CELLS) {
    return buildPrefixSuffixDiff(oldLines, newLines);
  }

  return buildLcsDiff(oldLines, newLines);
}

function contextLine(text: string, oldIndex: number, newIndex: number): DiffLine {
  return {
    kind: "context",
    oldLine: oldIndex + 1,
    newLine: newIndex + 1,
    text,
  };
}

function removedLine(text: string, oldIndex: number): DiffLine {
  return {
    kind: "removed",
    oldLine: oldIndex + 1,
    newLine: null,
    text,
  };
}

function addedLine(text: string, newIndex: number): DiffLine {
  return {
    kind: "added",
    oldLine: null,
    newLine: newIndex + 1,
    text,
  };
}

function buildLcsDiff(oldLines: string[], newLines: string[]) {
  const table = Array.from({ length: oldLines.length + 1 }, () =>
    new Uint32Array(newLines.length + 1),
  );

  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      lines.push(contextLine(oldLines[oldIndex], oldIndex, newIndex));
      oldIndex += 1;
      newIndex += 1;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      lines.push(removedLine(oldLines[oldIndex], oldIndex));
      oldIndex += 1;
    } else {
      lines.push(addedLine(newLines[newIndex], newIndex));
      newIndex += 1;
    }
  }

  while (oldIndex < oldLines.length) {
    lines.push(removedLine(oldLines[oldIndex], oldIndex));
    oldIndex += 1;
  }
  while (newIndex < newLines.length) {
    lines.push(addedLine(newLines[newIndex], newIndex));
    newIndex += 1;
  }

  return lines;
}

function buildPrefixSuffixDiff(oldLines: string[], newLines: string[]) {
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]
  ) {
    suffix += 1;
  }

  const lines: DiffLine[] = [];
  for (let index = 0; index < prefix; index += 1) {
    lines.push(contextLine(oldLines[index], index, index));
  }
  for (let index = prefix; index < oldLines.length - suffix; index += 1) {
    lines.push(removedLine(oldLines[index], index));
  }
  for (let index = prefix; index < newLines.length - suffix; index += 1) {
    lines.push(addedLine(newLines[index], index));
  }
  for (let offset = suffix; offset > 0; offset -= 1) {
    const oldIndex = oldLines.length - offset;
    const newIndex = newLines.length - offset;
    lines.push(contextLine(oldLines[oldIndex], oldIndex, newIndex));
  }

  return lines;
}
