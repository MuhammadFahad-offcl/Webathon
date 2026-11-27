"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import {
  applyWorkspacePreferences,
  DEFAULT_WORKSPACE_PREFERENCES,
  parseWorkspacePreferences,
} from "@/frontend/workspace/preferences";
import type { WorkspacePreferences } from "@/lib/validation/preferences";

const PREFERENCES_KEY = "examsys.prefs";
const PENDING_KEY = "examsys.prefs.pending";

type SaveState = "loading" | "saving" | "synced" | "local";
type StoredPreferences = {
  preferences: WorkspacePreferences;
  exists: boolean;
  pending: boolean;
  error: string | null;
};

function readStoredPreferences(): StoredPreferences {
  if (typeof window === "undefined") {
    return {
      preferences: DEFAULT_WORKSPACE_PREFERENCES,
      exists: false,
      pending: false,
      error: null,
    };
  }
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    const parsed = raw ? parseWorkspacePreferences(JSON.parse(raw)) : null;
    return {
      preferences: parsed ?? DEFAULT_WORKSPACE_PREFERENCES,
      exists: parsed !== null,
      pending: localStorage.getItem(PENDING_KEY) === "true",
      error: raw && !parsed ? "Saved preferences were invalid; defaults are in use." : null,
    };
  } catch {
    return {
      preferences: DEFAULT_WORKSPACE_PREFERENCES,
      exists: false,
      pending: false,
      error: "Preferences could not be read from this device.",
    };
  }
}

export function useWorkspacePreferences() {
  const [preferences, setPreferences] = useState(() => readStoredPreferences().preferences);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [error, setError] = useState<string | null>(null);
  const preferencesRef = useRef(preferences);
  const versionRef = useRef(0);

  const persist = useCallback(async (value: WorkspacePreferences) => {
    const version = ++versionRef.current;
    if (!navigator.onLine) {
      setSaveState("local");
      setError("Preferences are saved on this device and will sync when you reconnect.");
      return;
    }

    setSaveState("saving");
    try {
      await apiFetch<{ prefs: WorkspacePreferences }>("/api/me/preferences", {
        method: "PUT",
        body: JSON.stringify({ prefs: value }),
      });
      if (version !== versionRef.current) return;
      let markerError = false;
      try {
        localStorage.removeItem(PENDING_KEY);
      } catch {
        markerError = true;
      }
      setDirty(false);
      setSaveState("synced");
      setError(markerError ? "Preferences synced, but the local sync marker could not be cleared." : null);
    } catch (saveError) {
      if (version !== versionRef.current) return;
      setSaveState("local");
      setError(saveError instanceof ApiClientError
        ? `Preferences remain on this device. ${saveError.message}`
        : "Preferences remain on this device but could not sync.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      const stored = await Promise.resolve().then(readStoredPreferences);
      if (!active) return;
      preferencesRef.current = stored.preferences;
      applyWorkspacePreferences(stored.preferences);
      try {
        const response = await apiFetch<{ prefs: unknown }>("/api/me/preferences");
        if (!active) return;
        const serverPreferences = parseWorkspacePreferences(response.prefs);
        const chosen = stored.pending
          ? stored.preferences
          : serverPreferences ?? stored.preferences;
        preferencesRef.current = chosen;
        setPreferences(chosen);
        applyWorkspacePreferences(chosen);
        if (response.prefs && !serverPreferences) {
          setError("Account preferences are invalid; using preferences from this device.");
        } else if (serverPreferences) {
          setError(null);
        } else if (stored.error) {
          setError(stored.error);
        }
        if (serverPreferences && !stored.pending) {
          try {
            localStorage.setItem(PREFERENCES_KEY, JSON.stringify(serverPreferences));
            localStorage.removeItem(PENDING_KEY);
          } catch {
            setError("Preferences loaded, but could not be cached on this device.");
          }
        } else if (stored.pending || (!response.prefs && stored.exists)) {
          setDirty(true);
        }
        setSaveState("synced");
      } catch (loadError) {
        if (!active) return;
        const message = loadError instanceof ApiClientError
          ? `Using device preferences. ${loadError.message}`
          : "Using device preferences; account preferences could not be loaded.";
        setError(stored.error ? `${stored.error} ${message}` : message);
        if (stored.pending) setDirty(true);
        setSaveState("local");
      } finally {
        if (active) setLoaded(true);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded || !dirty) return;
    const timer = window.setTimeout(() => void persist(preferences), 500);
    return () => window.clearTimeout(timer);
  }, [dirty, loaded, persist, preferences]);

  useEffect(() => {
    function syncWhenOnline() {
      if (dirty) void persist(preferencesRef.current);
    }
    window.addEventListener("online", syncWhenOnline);
    return () => window.removeEventListener("online", syncWhenOnline);
  }, [dirty, persist]);

  const updatePreferences = useCallback(<K extends keyof WorkspacePreferences>(
    key: K,
    value: WorkspacePreferences[K],
  ) => {
    const next = { ...preferencesRef.current, [key]: value };
    preferencesRef.current = next;
    setPreferences(next);
    applyWorkspacePreferences(next);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      localStorage.setItem(PENDING_KEY, "true");
    } catch {
      setError("Preferences apply now, but could not be stored on this device.");
    }
    versionRef.current += 1;
    setDirty(true);
  }, []);

  return { preferences, updatePreferences, loaded, saveState, error };
}
