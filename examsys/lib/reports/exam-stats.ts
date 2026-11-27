import { PASS_PERCENT } from "@/lib/constants";

/**
 * Small, self-contained statistics for the exam summary PDF. Pure functions so they are
 * unit-testable. Inputs are real (non-sandbox) GRADED attempts; `total` is the sum of the
 * attempt's snapshot marks (same rule as Member 1's `candidateResult`).
 */

export type ScoredAttempt = { score: number; total: number };

export type ExamStats = {
  attempts: number;
  average: number | null;
  median: number | null;
  highest: number | null;
  lowest: number | null;
  /** Mean of the attempts' percentages (0-100). */
  averagePercent: number | null;
  passed: number;
  /** Share of attempts at or above the pass mark, 0-1. */
  passRate: number | null;
};

export type DistributionBucket = { from: number; to: number; count: number };

export function percentOf(score: number, total: number) {
  return total > 0 ? (score / total) * 100 : 0;
}

export const isPass = (score: number, total: number, passPercent = PASS_PERCENT) =>
  percentOf(score, total) >= passPercent;

const round2 = (value: number) => Math.round(value * 100) / 100;

export function computeExamStats(attempts: ScoredAttempt[], passPercent = PASS_PERCENT): ExamStats {
  const n = attempts.length;
  if (n === 0) {
    return { attempts: 0, average: null, median: null, highest: null, lowest: null, averagePercent: null, passed: 0, passRate: null };
  }
  const scores = attempts.map((a) => a.score).sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  const passed = attempts.filter((a) => isPass(a.score, a.total, passPercent)).length;
  return {
    attempts: n,
    average: round2(scores.reduce((sum, s) => sum + s, 0) / n),
    median: round2(median),
    highest: scores[n - 1],
    lowest: scores[0],
    averagePercent: round2(attempts.reduce((sum, a) => sum + percentOf(a.score, a.total), 0) / n),
    passed,
    passRate: passed / n,
  };
}

/** Ten buckets of 10 percentage points; `from` inclusive, `to` exclusive, the last includes 100. */
export function scoreDistribution(percentages: number[]): DistributionBucket[] {
  const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 10, count: 0 }));
  for (const p of percentages) {
    const index = Math.min(9, Math.max(0, Math.floor(p / 10)));
    buckets[index].count++;
  }
  return buckets;
}

/** Sorts by score (highest first, then name) and assigns competition ranks (1, 1, 3). */
export function rankByScore<T extends { score: number; name: string }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || sorted[index - 1].score !== row.score) rank = index + 1;
    return { ...row, rank };
  });
}
