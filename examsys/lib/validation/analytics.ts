/**
 * Response shapes of the analytics endpoints (docs/api.md section 15), shared by the
 * server (`lib/reports/analytics.ts`) and the exam page's Analytics tab. Types only, so
 * the client bundle never pulls in server code.
 */

export type DifficultyName = "EASY" | "MEDIUM" | "HARD";
export type QuestionTypeName = "MCQ" | "MULTI" | "WRITTEN";
export type QuestionFlag = "LOW_CORRECT" | "HIGH_SKIPPED";

export type DistributionBucket = { from: number; to: number; count: number };

export type StatSummary = {
  average: number | null;
  median: number | null;
  highest: number | null;
  lowest: number | null;
};

/** GET /api/exams/:id/analytics */
export type ExamAnalytics = {
  exam: { id: string; title: string; totalMarks: number; durationMin: number };
  counts: {
    enrolled: number;
    /** Finalized (SUBMITTED or GRADED) real attempts: the population of every statistic. */
    attempted: number;
    graded: number;
    /** Finalized attempts with written answers still awaiting marks (provisional scores). */
    pendingGrading: number;
    /** Real attempts still running (not part of any statistic). */
    inProgress: number;
  };
  /** Raw scores (marks). `null` when there are no finalized attempts. */
  score: StatSummary;
  /** Score as a percentage of each attempt's own snapshot total. */
  percentage: StatSummary;
  passPercent: number;
  /** Share of attempts with percentage >= passPercent, 0..1 (`null` with no attempts). */
  passRate: number | null;
  passed: number;
  failed: number;
  /** Mean of `submittedAt - startedAt`, capped at the exam duration (`null` with no attempts). */
  avgTimeUsedMin: number | null;
  /** Ten buckets of score percentage; `from` inclusive, `to` exclusive (last one includes 100). */
  distribution: DistributionBucket[];
};

export type WrongOption = { optionId: string; text: string; count: number };

export type QuestionAnalyticsItem = {
  questionId: string;
  text: string;
  topic: string;
  type: QuestionTypeName;
  marks: number;
  declaredDifficulty: DifficultyName;
  /** From correctPct: >= 70 EASY, 40-70 MEDIUM, < 40 HARD; `null` when nothing is graded yet. */
  observedDifficulty: DifficultyName | null;
  /** Finalized attempts that contained this question. */
  attempts: number;
  /** Written answers that still await marks (excluded from correct/avg/discrimination). */
  pendingGrading: number;
  /**
   * % of graded answers counted correct: objective = full marks; written = awarded >= 50% of marks.
   * `null` when no answer is graded yet.
   */
  correctPct: number | null;
  /** % of attempts with no response, an empty `optionIds` array or blank text. */
  skippedPct: number;
  /** Average awardedMarks / marks over graded answers, in %. */
  avgMarksPct: number | null;
  /** Most frequently picked incorrect option (MCQ/MULTI); `null` for WRITTEN or none picked. */
  mostChosenWrongOption: WrongOption | null;
  /**
   * Discrimination index: correct rate of the top 27% of attempts (by total score) minus that
   * of the bottom 27%, -1..1. `null` with fewer than 4 graded answers.
   */
  discrimination: number | null;
  flags: QuestionFlag[];
};

/** GET /api/exams/:id/questions/analytics */
export type QuestionAnalytics = { items: QuestionAnalyticsItem[] };
