import { PASS_PERCENT } from "@/lib/constants";
import { isPass } from "./exam-stats";

/** What the public verification page may reveal about a result (api.md section 16.3). */

export type ScoreBand = "Pass" | "Fail";

/**
 * "Ayesha Khan" -> "A. K.", "Madonna" -> "M.". One initial per name part (first letter or
 * digit, so punctuation like "(Dr.)" is skipped), at most four parts.
 */
export function maskName(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part.match(/[\p{L}\p{N}]/u)?.[0])
    .filter((initial): initial is string => !!initial)
    .slice(0, 4)
    .map((initial) => `${initial.toLocaleUpperCase()}.`);
  return initials.length ? initials.join(" ") : "-";
}

/** Pass/Fail against PASS_PERCENT of the attempt's total marks. Never the exact score. */
export function scoreBand(score: number, total: number, passPercent = PASS_PERCENT): ScoreBand {
  return isPass(score, total, passPercent) ? "Pass" : "Fail";
}
