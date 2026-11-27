import { describe, expect, it } from "vitest";
import { formatOpensIn } from "@/frontend/candidate/exam-time";

describe("formatOpensIn", () => {
  const now = Date.parse("2026-11-27T12:00:00.000Z");

  it("shows a minute countdown below one hour", () => {
    expect(formatOpensIn(new Date(now + 12 * 60_000).toISOString(), now)).toBe("Opens in 12 min");
  });

  it("rounds up and formats hours and minutes", () => {
    expect(formatOpensIn(new Date(now + 60 * 60_000 + 1).toISOString(), now)).toBe("Opens in 1h 1m");
  });

  it("uses days for longer countdowns", () => {
    expect(formatOpensIn(new Date(now + (24 * 60 + 15) * 60_000).toISOString(), now)).toBe("Opens in 1d 0h");
  });

  it("handles expired or invalid schedule values", () => {
    expect(formatOpensIn(new Date(now - 1).toISOString(), now)).toBe("Opening soon");
    expect(formatOpensIn("not-a-date", now)).toBe("Opening soon");
  });
});
