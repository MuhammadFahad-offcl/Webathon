import {
  workspacePreferencesSchema,
  type WorkspacePreferences,
} from "@/lib/validation/preferences";

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  theme: "light",
  fontSize: "M",
  density: "comfortable",
  palettePosition: "right",
};

export function parseWorkspacePreferences(value: unknown): WorkspacePreferences | null {
  const parsed = workspacePreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function applyWorkspacePreferences(preferences: WorkspacePreferences): void {
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  root.dataset.fontSize = preferences.fontSize;
  root.dataset.density = preferences.density;
}
