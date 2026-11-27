import { describe, expect, it } from "vitest";
import {
  discriminationIndex,
  isCorrect,
  isPass,
  isSkipped,
  median,
  observedDifficulty,
  percentageHistogram,
  questionFlags,
  round,
  summarize,
  summarizeExam,
  summarizeQuestions,
  type AnalyticsAttempt,
} from "./analytics";

describe("median / summarize", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("summarizes without NaN on empty input", () => {
    expect(summarize([])).toEqual({ average: null, median: null, highest: null, lowest: null });
    expect(summarize([1, 2, 2])).toEqual({ average: 1.67, median: 2, highest: 2, lowest: 1 });
  });

  it("rounds away float noise", () => {
    expect(round((3 / 10) * 100, 6)).toBe(30);
    expect(round(-1.25, 1)).toBe(-1.3); // half away from zero
    expect(round(2 / 3, 1)).toBe(0.7);
  });
});

describe("percentageHistogram", () => {
  it("has ten 10-point buckets, `to` exclusive, 100 in the last bucket", () => {
    const buckets = percentageHistogram([0, 9.99, 10, 55, 99.9, 100, (3 / 10) * 100]);
    expect(buckets).toHaveLength(10);
    expect(buckets[0]).toEqual({ from: 0, to: 10, count: 2 });
    expect(buckets[1].count).toBe(1);
    expect(buckets[3].count).toBe(1); // 30.000000000000004 is 30
    expect(buckets[5].count).toBe(1);
    expect(buckets[9]).toEqual({ from: 90, to: 100, count: 2 });
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(7);
  });

  it("returns zero-count buckets with no data and clamps out-of-range values", () => {
    expect(percentageHistogram([]).every((bucket) => bucket.count === 0)).toBe(true);
    const clamped = percentageHistogram([-5, 140, Number.NaN]);
    expect(clamped[0].count).toBe(1);
    expect(clamped[9].count).toBe(1);
  });
});

describe("answer rules", () => {
  it("detects skipped responses", () => {
    expect(isSkipped(null)).toBe(true);
    expect(isSkipped({ optionIds: [] })).toBe(true);
    expect(isSkipped({ text: "   " })).toBe(true);
    expect(isSkipped({ optionIds: ["a"] })).toBe(false);
    expect(isSkipped({ text: "answer" })).toBe(false);
  });

  it("objective needs full marks, written needs half, ungraded is unknown", () => {
    expect(isCorrect("MCQ", 2, 2)).toBe(true);
    expect(isCorrect("MULTI", 2, 1)).toBe(false);
    expect(isCorrect("WRITTEN", 5, 2.5)).toBe(true);
    expect(isCorrect("WRITTEN", 5, 2.4)).toBe(false);
    expect(isCorrect("WRITTEN", 5, null)).toBeNull();
  });

  it("passes at PASS_PERCENT inclusive", () => {
    expect(isPass(40)).toBe(true);
    expect(isPass(39.99)).toBe(false);
    expect(isPass((2 / 5) * 100, 40)).toBe(true);
  });
});

describe("observedDifficulty / flags", () => {
  it("labels by correct percentage", () => {
    expect(observedDifficulty(70)).toBe("EASY");
    expect(observedDifficulty(69.9)).toBe("MEDIUM");
    expect(observedDifficulty(40)).toBe("MEDIUM");
    expect(observedDifficulty(39.9)).toBe("HARD");
    expect(observedDifficulty(null)).toBeNull();
  });

  it("flags low correct (<20) and high skipped (>30)", () => {
    expect(questionFlags(19.9, 30.1)).toEqual(["LOW_CORRECT", "HIGH_SKIPPED"]);
    expect(questionFlags(20, 30)).toEqual([]);
    expect(questionFlags(null, 0)).toEqual([]);
  });
});

describe("discriminationIndex", () => {
  it("needs at least 4 rows", () => {
    expect(discriminationIndex([{ total: 1, correct: true }, { total: 0, correct: false }, { total: 2, correct: true }])).toBeNull();
  });

  it("compares the top and bottom 27%", () => {
    // 4 rows -> groups of 1: best got it right, worst did not -> 1.
    const rows = [
      { total: 10, correct: true },
      { total: 2, correct: false },
      { total: 6, correct: false },
      { total: 8, correct: true },
    ];
    expect(discriminationIndex(rows)).toBe(1);
    // Reversed: only the weak candidates get it right -> -1.
    expect(discriminationIndex(rows.map((row) => ({ ...row, correct: !row.correct })))).toBe(-1);
    // 10 rows -> groups of 3: upper 2/3 correct, lower 1/3 correct -> 0.33.
    const ten = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((total, index) => ({ total, correct: [0, 1, 9].includes(index) }));
    expect(discriminationIndex(ten)).toBe(0.33);
  });
});

const option = (id: string, isCorrect: boolean) => ({ id, text: `Text ${id}`, isCorrect });
const mcqSnapshot = { type: "MCQ", text: "Pick", topic: "T", difficulty: "EASY", negativeMarks: 0, multiScheme: "ALL_OR_NOTHING", options: [option("a", true), option("b", false), option("c", false)] };
const writtenSnapshot = { type: "WRITTEN", text: "Explain", topic: "T", difficulty: "HARD", negativeMarks: 0, multiScheme: "ALL_OR_NOTHING", options: [] };

function attempt(id: string, mcq: string | null, written: { text: string; awarded: number | null }, minutes: number): AnalyticsAttempt {
  const mcqAwarded = mcq === "a" ? 2 : 0;
  const pending = written.awarded === null;
  const startedAt = new Date("2026-11-27T10:00:00.000Z");
  return {
    id,
    status: pending ? "SUBMITTED" : "GRADED",
    score: mcqAwarded + (written.awarded ?? 0),
    startedAt,
    submittedAt: new Date(startedAt.getTime() + minutes * 60_000),
    questions: [
      { questionId: "q-mcq", order: 1, marks: 2, snapshot: mcqSnapshot, answer: { response: mcq ? { optionIds: [mcq] } : null, awardedMarks: mcqAwarded } },
      { questionId: "q-written", order: 2, marks: 8, snapshot: writtenSnapshot, answer: { response: { text: written.text }, awardedMarks: written.awarded } },
    ],
  };
}

describe("summarizeExam / summarizeQuestions", () => {
  const attempts = [
    attempt("1", "a", { text: "good", awarded: 8 }, 20), // 10/10 = 100%
    attempt("2", "b", { text: "ok", awarded: 4 }, 30), // 4/10 = 40%
    attempt("3", "b", { text: "", awarded: 0 }, 90), // 0% (time capped at 60)
    attempt("4", null, { text: "pending", awarded: null }, 40), // 0/10 so far, SUBMITTED
  ];

  it("computes exam statistics", () => {
    const summary = summarizeExam({ attempts, enrolled: 5, inProgress: 1, durationMin: 60 });
    expect(summary.counts).toEqual({ enrolled: 5, attempted: 4, graded: 3, pendingGrading: 1, inProgress: 1 });
    expect(summary.score).toEqual({ average: 3.5, median: 2, highest: 10, lowest: 0 });
    expect(summary.percentage).toEqual({ average: 35, median: 20, highest: 100, lowest: 0 });
    expect(summary.passRate).toBe(0.5);
    expect([summary.passed, summary.failed]).toEqual([2, 2]);
    expect(summary.avgTimeUsedMin).toBe(37.5); // (20 + 30 + 60 + 40) / 4
    expect(summary.distribution.map((bucket) => bucket.count)).toEqual([2, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("returns nulls, not NaN, with no attempts", () => {
    const summary = summarizeExam({ attempts: [], enrolled: 3, inProgress: 0, durationMin: 60 });
    expect(summary.score.average).toBeNull();
    expect(summary.passRate).toBeNull();
    expect(summary.avgTimeUsedMin).toBeNull();
    expect(summary.distribution).toHaveLength(10);
    expect(JSON.stringify(summary)).not.toContain("NaN");
    expect(summarizeQuestions([])).toEqual([]);
  });

  it("computes per-question statistics", () => {
    const [mcq, written] = summarizeQuestions(attempts, ["q-mcq", "q-written"]);
    expect(mcq).toMatchObject({
      questionId: "q-mcq",
      type: "MCQ",
      declaredDifficulty: "EASY",
      attempts: 4,
      pendingGrading: 0,
      correctPct: 25,
      skippedPct: 25,
      avgMarksPct: 25,
      observedDifficulty: "HARD",
      mostChosenWrongOption: { optionId: "b", text: "Text b", count: 2 },
      discrimination: 1,
      flags: [],
    });
    // Written: 3 graded (8/8 correct, 4/8 = half -> correct, 0 -> wrong), 1 pending, 1 blank.
    expect(written).toMatchObject({
      questionId: "q-written",
      attempts: 4,
      pendingGrading: 1,
      correctPct: 66.7,
      skippedPct: 25,
      avgMarksPct: 50,
      observedDifficulty: "MEDIUM",
      mostChosenWrongOption: null,
      discrimination: null, // only 3 graded answers
      flags: [],
    });
  });
});
