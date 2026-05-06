/**
 * Launch tab — agent-first builder for choosing connection, workspace, and
 * session before opening a real coding-agent CLI in the user's Terminal.
 */
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@va/i18n";

import {
  createProfile,
  getLauncherPreferences,
  getProfile,
  listCatalog,
  listProfiles,
  setProfileConnection,
  upsertProfile,
  type LauncherPreferences,
} from "./api";
import { AgentLaunchBuilder } from "./AgentLaunchBuilder";
import { ProfileConnectionDialog } from "./ProfileConnectionDialog";
import { ProfileFormDialog } from "./ProfileFormDialog";
import type { ProfileFormSubmit } from "./ProfileFormDialog";
import type {
  CatalogEntry,
  ConnectionAgentId,
  ProfileConnectionPreference,
  ProfileDef,
  ProfileSummary,
} from "./types";

export function Launch() {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [prefs, setPrefs] = useState<LauncherPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileDef | null>(null);
  const [connectionEditing, setConnectionEditing] =
    useState<ProfileSummary | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [nextCatalog, nextProfiles, nextPrefs] = await Promise.all([
        listCatalog(),
        listProfiles(),
        getLauncherPreferences(),
      ]);
      setCatalog(nextCatalog);
      setProfiles(nextProfiles);
      setPrefs(nextPrefs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timeout);
  }, [toast]);

  function openNewEditor() {
    setEditing(null);
    setEditorOpen(true);
  }

  async function handleEdit(summary: ProfileSummary) {
    try {
      const full = await getProfile(summary.id);
      setEditing(full);
      setEditorOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSave(submit: ProfileFormSubmit) {
    if (submit.type === "create") {
      await createProfile(submit.draft);
    } else {
      await upsertProfile(submit.profile);
    }
    await refresh();
  }

  async function handleSaveConnection(
    agentId: ConnectionAgentId,
    preference: ProfileConnectionPreference,
  ) {
    if (!connectionEditing) return;
    await setProfileConnection(connectionEditing.id, agentId, preference);
    const nextPrefs = await getLauncherPreferences();
    setPrefs(nextPrefs);
  }

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="shrink-0 bg-destructive/10 px-3 py-1 text-xs text-destructive">
          {error}
        </div>
      )}
      {toast && (
        <div className="shrink-0 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-600">
          {toast}
        </div>
      )}

      {loading ? (
        <p className="p-3 text-xs text-muted-foreground">{t("Loading…")}</p>
      ) : (
        <AgentLaunchBuilder
          profiles={profiles}
          prefs={prefs}
          onPrefsChange={setPrefs}
          onProfilesChange={setProfiles}
          onNewProfile={openNewEditor}
          onEditProfile={(profile) => void handleEdit(profile)}
          onConnectionSettings={setConnectionEditing}
          onError={setError}
          onToast={setToast}
        />
      )}

      {editorOpen && (
        <ProfileFormDialog
          catalog={catalog}
          initial={editing}
          onClose={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}
      {connectionEditing && (
        <ProfileConnectionDialog
          profile={connectionEditing}
          connections={prefs?.profileConnections}
          onClose={() => setConnectionEditing(null)}
          onSave={handleSaveConnection}
        />
      )}
    </div>
  );
}
