import { z } from "zod";

/**
 * Evaluation & grading shapes (Member 2, PR 7), shared by the grading API
 * (/api/exams/:id/submissions, /api/attempts/:id/review, /api/exams/:id/grading/queue,
 * /api/answers/:id/grade) and the exam page's Grading and Results tabs.
 */

export const FEEDBACK_MAX = 2000;
/** The grading UI offers half marks; the server accepts any value in [0, marks]. */
export const MARKS_STEP = 0.5;

/**
 * Validates awarded marks against the question's maximum. Used live by the grading form
 * and by the server (which owns the authoritative `marks` from the attempt snapshot).
 * Returns an error message, or null when the value is acceptable.
 */
export function awardedMarksError(value: number | null | undefined, max: number): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return "Enter the marks to award";
  if (!Number.isFinite(value)) return "Enter a valid number";
  if (value < 0) return "Marks cannot be below 0";
  if (value > max) return `Marks cannot be more than ${max}`;
  return null;
}

/** PATCH /api/answers/:id/grade body. `feedback` omitted = unchanged; "" or null = cleared. */
export const gradeSchema = z.object({
  awardedMarks: z.number("Enter the marks to award").min(0, "Marks cannot be below 0"),
  feedback: z
    .string("Feedback must be text")
    .trim()
    .max(FEEDBACK_MAX, `Feedback must be at most ${FEEDBACK_MAX} characters`)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null)),
});
export type GradeInput = z.input<typeof gradeSchema>;
export type GradeData = z.output<typeof gradeSchema>;

const optionalId = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => value || undefined);

/** GET /api/exams/:id/grading/queue?questionId=&candidateId=&page=&pageSize= */
export const queueQuerySchema = z.object({
  /** The bank question id (`AttemptQuestion.questionId`). */
  questionId: optionalId,
  candidateId: optionalId,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type QueueQuery = z.output<typeof queueQuerySchema>;

// ---- Response shapes (dates are ISO strings) -------------------------------------------

export type AttemptStatusName = "IN_PROGRESS" | "SUBMITTED" | "GRADED";

export type CandidateRef = { id: string; name: string; email: string; rollNo: string | null };

/** GET /api/exams/:id/submissions item (real attempts only). */
export type SubmissionItem = {
  attemptId: string;
  candidate: CandidateRef;
  status: AttemptStatusName;
  startedAt: string;
  submittedAt: string | null;
  /** Null while the attempt is in progress. */
  score: number | null;
  /** Sum of the attempt's question marks (snapshot). */
  totalMarks: number;
  /** Written answers awaiting marks (0 while in progress). */
  pendingWritten: number;
  lateSyncCount: number;
  incidentCount: number;
};

export type SubmissionsSummary = {
  total: number;
  inProgress: number;
  /** Finalized, still waiting for written marks. */
  submitted: number;
  graded: number;
  pendingWritten: number;
};

export type SubmissionsResponse = {
  exam: { id: string; title: string; resultsPublishedAt: string | null };
  items: SubmissionItem[];
  summary: SubmissionsSummary;
};

export type ReviewOption = { id: string; text: string; isCorrect: boolean };

export type ReviewAnswer = {
  id: string;
  response: { optionIds?: string[]; text?: string } | null;
  flagged: boolean;
  awardedMarks: number | null;
  feedback: string | null;
  gradedAt: string | null;
};

export type ReviewQuestion = {
  attemptQuestionId: string;
  questionId: string;
  order: number;
  type: "MCQ" | "MULTI" | "WRITTEN";
  topic: string;
  text: string;
  marks: number;
  negativeMarks: number;
  multiScheme: "ALL_OR_NOTHING" | "PARTIAL";
  /** Empty for WRITTEN. Includes the answer key (examiner view). */
  options: ReviewOption[];
  answer: ReviewAnswer | null;
};

/** GET /api/attempts/:id/review (examiner view, WITH answer keys). */
export type ReviewResponse = {
  exam: { id: string; title: string; resultsPublishedAt: string | null };
  attempt: {
    id: string;
    status: AttemptStatusName;
    isSandbox: boolean;
    score: number | null;
    totalMarks: number;
    startedAt: string;
    submittedAt: string | null;
    lateSyncCount: number;
    candidate: CandidateRef;
  };
  questions: ReviewQuestion[];
  incidents: { type: string; at: string; meta: unknown }[];
};

export type QueueItem = {
  answerId: string;
  attemptId: string;
  candidate: CandidateRef;
  question: { attemptQuestionId: string; questionId: string; order: number; text: string; topic: string; marks: number };
  response: { text: string };
  feedback: string | null;
  submittedAt: string | null;
};

/** GET /api/exams/:id/grading/queue */
export type QueueResponse = {
  items: QueueItem[];
  page: number;
  pageSize: number;
  total: number;
  /** Written answers of finalized real attempts (unanswered ones are auto-graded 0). */
  progress: { graded: number; total: number };
  /** Values for the filter dropdowns. */
  filters: {
    questions: { questionId: string; order: number; text: string }[];
    candidates: { id: string; name: string }[];
  };
  resultsPublishedAt: string | null;
};

/** PATCH /api/answers/:id/grade */
export type GradeResponse = {
  answer: { id: string; awardedMarks: number; feedback: string | null; gradedAt: string };
  attempt: { id: string; status: AttemptStatusName; score: number | null };
};

/** Member 1's POST /api/exams/:id/results/publish (success and 409 `details.blockers`). */
export type PublishResultsResponse = { publishedAt: string; reportsIssued: number; alreadyPublished: boolean };
export type PublishBlocker =
  | { type: "IN_PROGRESS"; attemptId: string; candidate: { id: string; name: string } }
  | { type: "UNGRADED_WRITTEN"; attemptId: string; candidate: { id: string; name: string }; count: number };
