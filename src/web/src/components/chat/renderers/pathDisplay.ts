function normalizeForCompare(path: string) {
  return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
}

export function workspaceRelativePath(path: string, workspacePath?: string) {
  if (!workspacePath) return null;

  const normalizedPath = normalizeForCompare(path);
  const normalizedWorkspace = normalizeForCompare(workspacePath);
  if (!normalizedPath || !normalizedWorkspace) return null;
  if (normalizedPath === normalizedWorkspace) return ".";

  const prefix = `${normalizedWorkspace}/`;
  if (!normalizedPath.startsWith(prefix)) return null;
  return normalizedPath.slice(prefix.length) || ".";
}

export function allPathsInsideWorkspace(paths: string[], workspacePath?: string) {
  return (
    Boolean(workspacePath) &&
    paths.every((path) => workspaceRelativePath(path, workspacePath) !== null)
  );
}
