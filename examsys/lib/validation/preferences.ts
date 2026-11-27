import { z } from "zod";

export const workspacePreferencesSchema = z.object({
  theme: z.enum(["light", "dark", "contrast"]),
  fontSize: z.enum(["S", "M", "L", "XL"]),
  density: z.enum(["comfortable", "compact"]),
  palettePosition: z.enum(["left", "right", "bottom"]),
}).strict();

export const updatePreferencesSchema = z.object({
  prefs: workspacePreferencesSchema,
}).strict();

export type WorkspacePreferences = z.infer<typeof workspacePreferencesSchema>;
