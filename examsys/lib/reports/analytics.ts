import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api/errors";
import { GRACE_MS, PASS_PERCENT } from "@/lib/constants";
import { finalizeIfExpired } from "@/lib/services/attempt-service";
import type {
  DifficultyName,
  DistributionBucket,
  ExamAnalytics,
  QuestionAnalytics,
  QuestionAnalyticsItem,
  QuestionFlag,
  QuestionTypeName,
  StatSummary,
  WrongOption,
} from "@/lib/validation/analytics";

/**
 * Exam and question analytics (Member 2, Phase H; docs/api.md section 15, database.md section 9).
 *
 * Population: REAL (`isSandbox: false`) attempts that are finalized (`SUBMITTED` or `GRADED`).
 * In-progress attempts are never counted; expired ones are lazily finalized first, like the
 * monitor does. Written answers still awaiting marks are left out of the correctness numbers.
 *
 * The DB loaders (`getExamAnalytics`, `getQuestionAnalytics`) only fetch rows; every number is
 * computed by the pure functions below (`summarizeExam`, `summarizeQuestions` and their
 * helpers), which the unit tests cover without a database and the PDF report can reuse.
 * Callers are responsible for authorization (the routes use `assertExamOwner`).
 */

// ---------------------------------------------------------------------------------------------
// Rules (one place, so the UI copy and the PDF report can quote them)
// ---------------------------------------------------------------------------------------------

export const HISTOGRAM_BUCKETS = 10;
/** A WRITTEN answer counts as correct when it earned at least this share of its marks. */
export const WRITTEN_CORRECT_SHARE = 0.5;
/** Size of the upper and lower groups of the discrimination index. */
export const DISCRIMINATION_GROUP_SHARE = 0.27;
/** Fewer graded answers than this and the discrimination index is not reported. */
export const DISCRIMINATION_MIN_ATTEMPTS = 4;
/** Observed difficulty: correctPct >= EASY_MIN_PCT is EASY, < HARD_BELOW_PCT is HARD. */
export const EASY_MIN_PCT = 70;
export const HARD_BELOW_PCT = 40;
/** Flags (docs/api.md 15.2). */
export const LOW_CORRECT_BELOW_PCT = 20;
export const HIGH_SKIPPED_ABOVE_PCT = 30;

// ---------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------

/** Rounds half away from zero to `digits` decimals (kills float noise like 30.000000000000004). */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** average / median / highest / lowest, rounded; all `null` for an empty list. */
export function summarize(values: readonly number[], digits = 2): StatSummary {
  if (values.length === 0) return { average: null, median: null, highest: null, lowest: null };
  return {
    average: round(mean(values)!, digits),
    median: round(median(values)!, digits),
    highest: round(Math.max(...values), digits),
    lowest: round(Math.min(...values), digits),
  };
}

/**
 * Ten buckets of 10 percentage points. `from` inclusive, `to` exclusive, except the last bucket
 * which also holds 100. Out-of-range values are clamped. No values -> ten zero-count buckets.
 */
export function percentageHistogram(percentages: readonly number[], buckets = HISTOGRAM_BUCKETS): DistributionBucket[] {
  const width = 100 / buckets;
  const result = Array.from({ length: buckets }, (_, index) => ({
    from: round(index * width, 2),
    to: round((index + 1) * width, 2),
    count: 0,
  }));
  for (const raw of percentages) {
    if (!Number.isFinite(raw)) continue;
    const value = round(Math.min(100, Math.max(0, raw)), 6);
    const index = Math.min(buckets - 1, Math.floor(value / width));
    result[index].count++;
  }
  return result;
}

/** Score as a percentage of the attempt's own total (0 when the total is 0). */
export function scorePercentage(score: number, totalMarks: number): number {
  return totalMarks > 0 ? (score / totalMarks) * 100 : 0;
}

export function isPass(percentage: number, passPercent = PASS_PERCENT): boolean {
  return round(percentage, 6) >= passPercent;
}

/** `true` when the response is missing, has no option ids, or is blank text. */
export function isSkipped(response: unknown): boolean {
  if (!response || typeof response !== "object") return true;
  const value = response as { optionIds?: unknown; text?: unknown };
  if (typeof value.text === "string") return value.text.trim() === "";
  if (Array.isArray(value.optionIds)) return value.optionIds.length === 0;
  return true;
}

/**
 * Whether a graded answer counts as correct: objective (MCQ/MULTI) needs full marks;
 * WRITTEN needs at least `WRITTEN_CORRECT_SHARE` of the marks. `null` = not graded yet.
 */
export function isCorrect(type: QuestionTypeName, marks: number, awardedMarks: number | null): boolean | null {
  if (awardedMarks === null) return null;
  if (marks <= 0) return awardedMarks >= 0;
  const needed = type === "WRITTEN" ? marks * WRITTEN_CORRECT_SHARE : marks;
  return awardedMarks >= needed - 1e-9;
}

/** EASY / MEDIUM / HARD from the observed correct percentage (`null` when unknown). */
export function observedDifficulty(correctPct: number | null): DifficultyName | null {
  if (correctPct === null) return null;
  if (correctPct >= EASY_MIN_PCT) return "EASY";
  if (correctPct < HARD_BELOW_PCT) return "HARD";
  return "MEDIUM";
}

export function questionFlags(correctPct: number | null, skippedPct: number): QuestionFlag[] {
  const flags: QuestionFlag[] = [];
  if (correctPct !== null && correctPct < LOW_CORRECT_BELOW_PCT) flags.push("LOW_CORRECT");
  if (skippedPct > HIGH_SKIPPED_ABOVE_PCT) flags.push("HIGH_SKIPPED");
  return flags;
}

/**
 * Upper-lower discrimination index: rank the attempts by total score, take the top and bottom
 * `DISCRIMINATION_GROUP_SHARE` (at least one each) and return
 * `correct rate (upper) - correct rate (lower)`, between -1 and 1. Positive = strong candidates
 * get it right more often (good); near 0 or negative = the question does not separate them.
 * `null` with fewer than `DISCRIMINATION_MIN_ATTEMPTS` rows. Ties keep input order.
 */
export function discriminationIndex(rows: readonly { total: number; correct: boolean }[]): number | null {
  if (rows.length < DISCRIMINATION_MIN_ATTEMPTS) return null;
  const ranked = [...rows].sort((a, b) => b.total - a.total);
  const size = Math.max(1, Math.round(rows.length * DISCRIMINATION_GROUP_SHARE));
  const rate = (group: readonly { correct: boolean }[]) => group.filter((row) => row.correct).length / group.length;
  return round(rate(ranked.slice(0, size)) - rate(ranked.slice(-size)), 2);
}

// ---------------------------------------------------------------------------------------------
// Aggregation (pure): finalized attempts in, API payloads out
// ---------------------------------------------------------------------------------------------

type SnapshotOption = { id: string; text: string; isCorrect: boolean };
type Snapshot = {
  type: QuestionTypeName;
  text: string;
  topic: string;
  difficulty: DifficultyName;
  options: SnapshotOption[];
};

/** The fields of a finalized attempt the analytics need (see `loadFinalizedAttempts`). */
export type AnalyticsAttempt = {
  id: string;
  status: "SUBMITTED" | "GRADED";
  score: number | null;
  startedAt: Date;
  submittedAt: Date | null;
  questions: {
    questionId: string;
    order: number;
    marks: number;
    snapshot: unknown;
    answer: { response: unknown; awardedMarks: number | null } | null;
  }[];
};

const DIFFICULTIES: readonly DifficultyName[] = ["EASY", "MEDIUM", "HARD"];
const TYPES: readonly QuestionTypeName[] = ["MCQ", "MULTI", "WRITTEN"];

/** Reads an AttemptQuestion snapshot defensively (it is JSON written by Member 1). */
export function readSnapshot(raw: unknown): Snapshot {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const options = Array.isArray(value.options) ? value.options : [];
  return {
    type: TYPES.includes(value.type as QuestionTypeName) ? (value.type as QuestionTypeName) : "MCQ",
    text: typeof value.text === "string" ? value.text : "",
    topic: typeof value.topic === "string" ? value.topic : "",
    difficulty: DIFFICULTIES.includes(value.difficulty as DifficultyName) ? (value.difficulty as DifficultyName) : "MEDIUM",
    options: options
      .filter((option): option is Record<string, unknown> => !!option && typeof option === "object")
      .map((option) => ({ id: String(option.id), text: String(option.text ?? ""), isCorrect: option.isCorrect === true })),
  };
}

function optionIdsOf(response: unknown): string[] {
  if (!response || typeof response !== "object") return [];
  const ids = (response as { optionIds?: unknown }).optionIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

const attemptScore = (attempt: AnalyticsAttempt) => attempt.score ?? 0;
const attemptTotal = (attempt: AnalyticsAttempt) => attempt.questions.reduce((sum, question) => sum + question.marks, 0);

export type ExamSummaryInput = {
  attempts: readonly AnalyticsAttempt[];
  enrolled: number;
  inProgress: number;
  durationMin: number;
  passPercent?: number;
};

/** Everything in `ExamAnalytics` except the `exam` block. */
export function summarizeExam(input: ExamSummaryInput): Omit<ExamAnalytics, "exam"> {
  const passPercent = input.passPercent ?? PASS_PERCENT;
  const attempts = input.attempts;
  const scores = attempts.map(attemptScore);
  const percentages = attempts.map((attempt) => scorePercentage(attemptScore(attempt), attemptTotal(attempt)));
  const passed = percentages.filter((percentage) => isPass(percentage, passPercent)).length;
  const minutes = attempts
    .filter((attempt) => attempt.submittedAt)
    .map((attempt) => {
      const used = (attempt.submittedAt!.getTime() - attempt.startedAt.getTime()) / 60_000;
      return Math.min(input.durationMin, Math.max(0, used));
    });
  const avgMinutes = mean(minutes);
  const graded = attempts.filter((attempt) => attempt.status === "GRADED").length;

  return {
    counts: {
      enrolled: input.enrolled,
      attempted: attempts.length,
      graded,
      pendingGrading: attempts.length - graded,
      inProgress: input.inProgress,
    },
    score: summarize(scores),
    percentage: summarize(percentages, 1),
    passPercent,
    passRate: attempts.length ? round(passed / attempts.length, 4) : null,
    passed,
    failed: attempts.length - passed,
    avgTimeUsedMin: avgMinutes === null ? null : round(avgMinutes, 1),
    distribution: percentageHistogram(percentages),
  };
}

type QuestionAccumulator = {
  questionId: string;
  snapshot: Snapshot;
  marks: number;
  orderSum: number;
  attempts: number;
  skipped: number;
  pending: number;
  marksShares: number[];
  ranking: { total: number; correct: boolean }[];
  wrong: Map<string, WrongOption>;
};

/**
 * Per-question statistics grouped by the bank `questionId`. Items follow `questionOrder`
 * (the exam's question order) when given, otherwise their average position in the attempts.
 */
export function summarizeQuestions(
  attempts: readonly AnalyticsAttempt[],
  questionOrder: readonly string[] = [],
): QuestionAnalyticsItem[] {
  const groups = new Map<string, QuestionAccumulator>();

  for (const attempt of attempts) {
    const total = attemptScore(attempt);
    for (const question of attempt.questions) {
      let group = groups.get(question.questionId);
      if (!group) {
        group = {
          questionId: question.questionId,
          snapshot: readSnapshot(question.snapshot),
          marks: question.marks,
          orderSum: 0,
          attempts: 0,
          skipped: 0,
          pending: 0,
          marksShares: [],
          ranking: [],
          wrong: new Map(),
        };
        groups.set(question.questionId, group);
      }
      group.attempts++;
      group.orderSum += question.order;

      const response = question.answer?.response ?? null;
      const skipped = isSkipped(response);
      if (skipped) group.skipped++;

      // A missing Answer row on a finalized attempt means unanswered -> 0 marks.
      const awarded = question.answer ? question.answer.awardedMarks : 0;
      const correct = isCorrect(group.snapshot.type, question.marks, awarded);
      if (correct === null) group.pending++;
      else {
        if (question.marks > 0) group.marksShares.push(awarded! / question.marks);
        group.ranking.push({ total, correct });
      }

      if (group.snapshot.type !== "WRITTEN" && !skipped) {
        const options = readSnapshot(question.snapshot).options;
        for (const id of new Set(optionIdsOf(response))) {
          const option = options.find((candidate) => candidate.id === id);
          if (!option || option.isCorrect) continue;
          const entry = group.wrong.get(id) ?? { optionId: id, text: option.text, count: 0 };
          entry.count++;
          group.wrong.set(id, entry);
        }
      }
    }
  }

  const position = new Map(questionOrder.map((id, index) => [id, index]));
  const sortKey = (group: QuestionAccumulator) => position.get(group.questionId) ?? questionOrder.length + group.orderSum / group.attempts;

  return [...groups.values()]
    .sort((a, b) => sortKey(a) - sortKey(b))
    .map((group) => {
      const graded = group.ranking.length;
      const correctPct = graded ? round((group.ranking.filter((row) => row.correct).length / graded) * 100, 1) : null;
      const skippedPct = round((group.skipped / group.attempts) * 100, 1);
      const avgShare = mean(group.marksShares);
      let mostChosenWrongOption: WrongOption | null = null;
      for (const entry of group.wrong.values()) {
        if (!mostChosenWrongOption || entry.count > mostChosenWrongOption.count) mostChosenWrongOption = { ...entry };
      }
      return {
        questionId: group.questionId,
        text: group.snapshot.text,
        topic: group.snapshot.topic,
        type: group.snapshot.type,
        marks: group.marks,
        declaredDifficulty: group.snapshot.difficulty,
        observedDifficulty: observedDifficulty(correctPct),
        attempts: group.attempts,
        pendingGrading: group.pending,
        correctPct,
        skippedPct,
        avgMarksPct: avgShare === null ? null : round(avgShare * 100, 1),
        mostChosenWrongOption: group.snapshot.type === "WRITTEN" ? null : mostChosenWrongOption,
        discrimination: discriminationIndex(group.ranking),
        flags: questionFlags(correctPct, skippedPct),
      };
    });
}

// ---------------------------------------------------------------------------------------------
// DB loaders
// ---------------------------------------------------------------------------------------------

/** Finalizes real attempts that are past their grace window, so they count as submitted. */
async function finalizeExpired(examId: string) {
  const expired = await prisma.attempt.findMany({
    where: { examId, isSandbox: false, status: "IN_PROGRESS", expiresAt: { lt: new Date(Date.now() - GRACE_MS) } },
    select: { id: true },
  });
  await Promise.all(expired.map((attempt) => finalizeIfExpired(attempt.id)));
}

async function loadExamData(examId: string) {
  await finalizeExpired(examId);
  const [exam, attempts, inProgress] = await Promise.all([
    prisma.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        title: true,
        totalMarks: true,
        durationMin: true,
        _count: { select: { enrollments: true } },
        questions: { orderBy: [{ order: "asc" }, { id: "asc" }], select: { questionId: true } },
      },
    }),
    prisma.attempt.findMany({
      where: { examId, isSandbox: false, status: { in: ["SUBMITTED", "GRADED"] } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        score: true,
        startedAt: true,
        submittedAt: true,
        questions: {
          orderBy: { order: "asc" },
          select: {
            questionId: true,
            order: true,
            marks: true,
            snapshot: true,
            answer: { select: { response: true, awardedMarks: true } },
          },
        },
      },
    }),
    prisma.attempt.count({ where: { examId, isSandbox: false, status: "IN_PROGRESS" } }),
  ]);
  if (!exam) throw notFound("Exam");
  return { exam, attempts: attempts as AnalyticsAttempt[], inProgress };
}

/** GET /api/exams/:id/analytics payload. Authorization is the caller's job. */
export async function getExamAnalytics(examId: string): Promise<ExamAnalytics> {
  const { exam, attempts, inProgress } = await loadExamData(examId);
  return {
    exam: { id: exam.id, title: exam.title, totalMarks: exam.totalMarks, durationMin: exam.durationMin },
    ...summarizeExam({ attempts, enrolled: exam._count.enrollments, inProgress, durationMin: exam.durationMin }),
  };
}

/** GET /api/exams/:id/questions/analytics payload. Authorization is the caller's job. */
export async function getQuestionAnalytics(examId: string): Promise<QuestionAnalytics> {
  const { exam, attempts } = await loadExamData(examId);
  return { items: summarizeQuestions(attempts, exam.questions.map((question) => question.questionId)) };
}
