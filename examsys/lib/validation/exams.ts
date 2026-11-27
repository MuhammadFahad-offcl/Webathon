import { z } from "zod";

/** Shared by the exams API (lib/server/exams.ts) and the examiner exam forms. */

export const EXAM_PHASES = ["DRAFT", "UPCOMING", "ONGOING", "COMPLETED", "ARCHIVED"] as const;
export type ExamPhaseName = (typeof EXAM_PHASES)[number];

export const MAX_DURATION_MIN = 1440;
export const MAX_EXAM_QUESTIONS = 200;
export const MAX_QUESTION_MARKS = 100;

const dateTimeSchema = z
  .string({ error: "Enter a date and time" })
  .min(1, "Enter a date and time")
  .pipe(z.iso.datetime({ offset: true, error: "Enter a valid date and time" }))
  .transform((value) => new Date(value));

/** Field rules without defaults, so `.partial()` (PATCH) never fills in missing keys. */
const examFields = {
  title: z
    .string({ error: "Enter a title" })
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(200, "Title must be at most 200 characters"),
  instructions: z.string().max(10_000, "Instructions must be at most 10,000 characters"),
  startAt: dateTimeSchema,
  endAt: dateTimeSchema,
  durationMin: z
    .number({ error: "Enter the duration in minutes" })
    .int("Duration must be a whole number of minutes")
    .min(1, "Duration must be greater than 0")
    .max(MAX_DURATION_MIN, `Duration can be at most ${MAX_DURATION_MIN} minutes (24 hours)`),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
};

/** Whole minutes between two instants (floored). */
export function windowMinutes(startAt: Date, endAt: Date) {
  return Math.floor((endAt.getTime() - startAt.getTime()) / 60_000);
}

/**
 * Schedule rules shared by create, PATCH (on the merged values) and publish-check:
 * `endAt > startAt` and the duration must fit in the window. Returns `{ field: message }`.
 */
export function scheduleIssues(schedule: { startAt: Date; endAt: Date; durationMin: number }) {
  const issues: Record<string, string> = {};
  if (!isValidSchedule(schedule)) return issues; // field-level errors already cover it
  if (schedule.endAt.getTime() <= schedule.startAt.getTime()) {
    issues.endAt = "End time must be after the start time";
  } else {
    const window = windowMinutes(schedule.startAt, schedule.endAt);
    if (schedule.durationMin > window) {
      issues.durationMin = `Duration can't be longer than the exam window (${window} min)`;
    }
  }
  return issues;
}

/**
 * zod 4 still runs object-level refinements when a field failed, so they receive raw input.
 * Schedule rules only apply once every schedule field parsed.
 */
function isValidSchedule(value: { startAt: unknown; endAt: unknown; durationMin: unknown }) {
  return (
    value.startAt instanceof Date &&
    !Number.isNaN(value.startAt.getTime()) &&
    value.endAt instanceof Date &&
    !Number.isNaN(value.endAt.getTime()) &&
    typeof value.durationMin === "number" &&
    Number.isFinite(value.durationMin)
  );
}

export const START_IN_PAST_MESSAGE = "Start time must be in the future";

/** POST /api/exams */
export const createExamSchema = z
  .object({
    ...examFields,
    instructions: examFields.instructions.default(""),
    shuffleQuestions: examFields.shuffleQuestions.default(false),
    shuffleOptions: examFields.shuffleOptions.default(false),
  })
  .superRefine((value, ctx) => {
    for (const [field, message] of Object.entries(scheduleIssues(value))) {
      ctx.addIssue({ code: "custom", path: [field], message });
    }
    if (value.startAt instanceof Date && value.startAt.getTime() <= Date.now()) {
      ctx.addIssue({ code: "custom", path: ["startAt"], message: START_IN_PAST_MESSAGE });
    }
  });
export type CreateExamInput = z.input<typeof createExamSchema>;
export type CreateExamData = z.output<typeof createExamSchema>;

/** PATCH /api/exams/:id - any subset; the merged schedule is re-validated on the server. */
export const updateExamSchema = z
  .object(examFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateExamInput = z.input<typeof updateExamSchema>;
export type UpdateExamData = z.output<typeof updateExamSchema>;

/** Fields that stay editable once an exam is locked (attempts exist / ongoing / ended). */
export const ALWAYS_EDITABLE_FIELDS = ["title", "instructions"] as const;

/** PUT /api/exams/:id/questions - replaces the whole assignment. */
export const assignQuestionsSchema = z
  .object({
    items: z
      .array(
        z.object({
          questionId: z.string({ error: "Question id is required" }).trim().min(1, "Question id is required"),
          marks: z
            .number({ error: "Enter the marks" })
            .gt(0, "Marks must be greater than 0")
            .max(MAX_QUESTION_MARKS, `Marks can be at most ${MAX_QUESTION_MARKS}`),
          order: z.number({ error: "Order is required" }).int("Order must be a whole number").min(1, "Order starts at 1"),
        }),
        { error: "items must be a list" },
      )
      .max(MAX_EXAM_QUESTIONS, `An exam can have at most ${MAX_EXAM_QUESTIONS} questions`),
  })
  .superRefine((value, ctx) => {
    if (!Array.isArray(value.items)) return;
    const ids = value.items.map((item) => item.questionId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "A question can only be added once" });
    }
    const orders = value.items.map((item) => item.order);
    if (new Set(orders).size !== orders.length) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "Each question needs a different order" });
    }
  });
export type AssignQuestionsInput = z.input<typeof assignQuestionsSchema>;
export type AssignQuestionsData = z.output<typeof assignQuestionsSchema>;

/** GET /api/exams?search=&phase= (empty phase = all) */
export const listExamsQuerySchema = z.object({
  search: z.string().trim().max(100).optional().default(""),
  phase: z
    .union([z.literal(""), z.enum(EXAM_PHASES)])
    .optional()
    .transform((value) => value || undefined),
});
export type ListExamsQuery = z.output<typeof listExamsQuerySchema>;

// ---- Response shapes (dates are ISO strings) -------------------------------------------

export type ExamSummary = {
  id: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  phase: ExamPhaseName;
  startAt: string;
  endAt: string;
  durationMin: number;
  totalMarks: number;
  questionCount: number;
  enrolledCount: number;
  /** Real (non-sandbox) attempts only. */
  attemptCount: number;
  resultsPublishedAt: string | null;
  createdBy: { id: string; name: string };
};

export type ExamQuestionDto = {
  questionId: string;
  order: number;
  marks: number;
  type: "MCQ" | "MULTI" | "WRITTEN";
  topic: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  text: string;
  optionCount: number;
};

export type ExamDetail = ExamSummary & {
  instructions: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  /** When locked only `title` and `instructions` can change, and questions can't be reassigned. */
  locked: boolean;
  lockReason: string | null;
  questions: ExamQuestionDto[];
};

export type PublishCheck = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  summary: {
    questionCount: number;
    totalMarks: number;
    enrolledCount: number;
    startAt: string;
    endAt: string;
    durationMin: number;
  };
};
