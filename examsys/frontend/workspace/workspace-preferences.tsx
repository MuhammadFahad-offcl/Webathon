"use client";

import { useState } from "react";
import { Button } from "@/frontend/components/ui/button";
import { Dialog } from "@/frontend/components/ui/dialog";
import type { WorkspacePreferences } from "@/lib/validation/preferences";

type Props = {
  preferences: WorkspacePreferences;
  loaded: boolean;
  saveState: "loading" | "saving" | "synced" | "local";
  error: string | null;
  onChange: <K extends keyof WorkspacePreferences>(key: K, value: WorkspacePreferences[K]) => void;
};

const themeOptions = ["light", "dark", "contrast"] as const;
const fontSizeOptions = ["S", "M", "L", "XL"] as const;
const densityOptions = ["comfortable", "compact"] as const;
const paletteOptions = ["left", "right", "bottom"] as const;

export function WorkspacePreferences({ preferences, loaded, saveState, error, onChange }: Readonly<Props>) {
  const [open, setOpen] = useState(false);

  function updateFromSelect<K extends keyof WorkspacePreferences>(
    key: K,
    value: string,
    options: readonly WorkspacePreferences[K][],
  ) {
    const matched = options.find((option) => option === value);
    if (matched !== undefined) onChange(key, matched);
  }

  const status = {
    loading: "Loading preferences…",
    saving: "Syncing preferences…",
    synced: "Preferences synced to your account.",
    local: "Using local preferences; account sync is unavailable.",
  }[saveState];

  return (
    <>
      <Button variant="secondary" type="button" onClick={() => setOpen(true)}>
        Preferences
      </Button>
      {open && <Dialog open={open} title="Workspace preferences" onClose={() => setOpen(false)}>
        <div className="grid gap-4">
          <label className="form-label" htmlFor="preference-theme">
            Theme
            <select
              className="field-control"
              id="preference-theme"
              value={preferences.theme}
              disabled={!loaded}
              onChange={(event) => updateFromSelect("theme", event.target.value, themeOptions)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="contrast">High contrast</option>
            </select>
          </label>
          <label className="form-label" htmlFor="preference-font-size">
            Font size
            <select
              className="field-control"
              id="preference-font-size"
              value={preferences.fontSize}
              disabled={!loaded}
              onChange={(event) => updateFromSelect("fontSize", event.target.value, fontSizeOptions)}
            >
              <option value="S">Small</option>
              <option value="M">Medium</option>
              <option value="L">Large</option>
              <option value="XL">Extra large</option>
            </select>
          </label>
          <label className="form-label" htmlFor="preference-density">
            Spacing
            <select
              className="field-control"
              id="preference-density"
              value={preferences.density}
              disabled={!loaded}
              onChange={(event) => updateFromSelect("density", event.target.value, densityOptions)}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label className="form-label" htmlFor="preference-palette">
            Question palette
            <select
              className="field-control"
              id="preference-palette"
              value={preferences.palettePosition}
              disabled={!loaded}
              onChange={(event) => updateFromSelect("palettePosition", event.target.value, paletteOptions)}
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="bottom">Below questions</option>
            </select>
          </label>
          <p className="text-sm text-muted" role="status" aria-live="polite">{status}</p>
          {error && <p className="text-sm text-[var(--warning)]" role="alert">{error}</p>}
        </div>
      </Dialog>}
    </>
  );
}
