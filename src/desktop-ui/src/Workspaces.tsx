import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Plus, Star, Trash2, RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { apiFetch } from "./lib/api";

interface WorkspaceItem {
  path: string;
  is_default: boolean;
  is_builtin: boolean;
}

interface WorkspacesResponse {
  workspaces: WorkspaceItem[];
  default_workspace: string;
}

export function Workspaces() {
  const [data, setData] = useState<WorkspacesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/workspaces`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const addWorkspace = async () => {
    setAdding(true);
    try {
      const selected = await open({ directory: true, multiple: false, title: "Select Workspace Folder" });
      if (!selected) { setAdding(false); return; }
      const path = typeof selected === "string" ? selected : selected[0];
      if (!path) { setAdding(false); return; }
      const res = await apiFetch(`/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error(await res.text());
      fetchWorkspaces();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const removeWorkspace = async (path: string) => {
    try {
      const res = await apiFetch(`/api/workspaces/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error(await res.text());
      fetchWorkspaces();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setDefault = async (path: string) => {
    try {
      const res = await apiFetch(`/api/workspaces/default`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error(await res.text());
      fetchWorkspaces();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-primary" />
          Workspaces
        </h2>
        <button
          onClick={fetchWorkspaces}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Workspace folders where agents build projects. The built-in workspace creates per-agent subdirectories automatically.
      </p>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Workspace list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {data?.workspaces.map((ws, i) => (
          <div
            key={ws.path}
            className={`flex items-center justify-between px-4 py-3 ${
              i > 0 ? "border-t border-border" : ""
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-mono truncate">{ws.path}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  {ws.is_builtin && (
                    <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                      Built-in
                    </span>
                  )}
                  {ws.is_default && (
                    <span className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                      <Star className="w-2.5 h-2.5" /> Default
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {!ws.is_default && (
                <button
                  onClick={() => setDefault(ws.path)}
                  className="p-1.5 rounded hover:bg-accent transition-colors"
                  title="Set as default"
                >
                  <Star className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}
              {!ws.is_builtin && (
                <button
                  onClick={() => removeWorkspace(ws.path)}
                  className="p-1.5 rounded hover:bg-destructive/10 transition-colors"
                  title="Remove workspace"
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              )}
            </div>
          </div>
        ))}

        {(!data || data.workspaces.length === 0) && !loading && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No workspaces configured
          </div>
        )}
      </div>

      {/* Add workspace */}
      <button
        onClick={addWorkspace}
        disabled={adding}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        <Plus className="w-3.5 h-3.5" />
        {adding ? "Selecting…" : "Add Workspace Folder"}
      </button>
    </div>
  );
}
