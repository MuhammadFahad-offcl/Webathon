import { describe, expect, it } from "vitest";
import { updatePreferencesSchema } from "@/lib/validation/preferences";

const preferences = {
  theme: "dark",
  fontSize: "L",
  density: "compact",
  palettePosition: "right",
} as const;

describe("updatePreferencesSchema", () => {
  it("accepts supported workspace preferences", () => {
    expect(updatePreferencesSchema.parse({ prefs: preferences })).toEqual({ prefs: preferences });
  });

  it("rejects unknown preference keys and invalid values", () => {
    expect(updatePreferencesSchema.safeParse({
      prefs: { ...preferences, zoom: "large" },
    }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({
      prefs: { ...preferences, theme: "sepia" },
    }).success).toBe(false);
  });
});
