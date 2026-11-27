import { z } from "zod";

/**
 * Question bank schemas, shared by the /api/questions endpoints, the
 * /examiner/questions forms and (later) the CSV/JSON question import.
 */

export const QUESTION_TYPES = ["MCQ", "MULTI", "WRITTEN"] as const;
export const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
export const MULTI_SCHEMES = ["ALL_OR_NOTHING", "PARTIAL"] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type MultiScheme = (typeof MULTI_SCHEMES)[number];

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
export const MAX_MARKS = 100;

export const topicSchema = z
  .string("Enter a topic")
  .trim()
  .min(1, "Enter a topic")
  .max(100, "Topic must be at most 100 characters");
export const questionTextSchema = z
  .string("Enter the question text")
  .trim()
  .min(1, "Enter the question text")
  .max(5000, "Question text must be at most 5000 characters");
export const difficultySchema = z.enum(DIFFICULTIES, "Choose EASY, MEDIUM or HARD");
export const questionTypeSchema = z.enum(QUESTION_TYPES, "Choose MCQ, MULTI or WRITTEN");
export const multiSchemeSchema = z.enum(MULTI_SCHEMES, "Choose ALL_OR_NOTHING or PARTIAL");
export const defaultMarksSchema = z
  .number("Enter a number")
  .gt(0, "Marks must be greater than 0")
  .max(MAX_MARKS, `Marks must be at most ${MAX_MARKS}`);
export const negativeMarksSchema = z
  .number("Enter a number")
  .min(0, "Negative marks cannot be below 0")
  .max(MAX_MARKS, `Negative marks must be at most ${MAX_MARKS}`);

/** One answer option; its `order` is its array index + 1. */
export const optionSchema = z.object({
  text: z
    .string("Enter the option text")
    .trim()
    .min(1, "Enter the option text")
    .max(1000, "Option text must be at most 1000 characters"),
  isCorrect: z.boolean("isCorrect must be true or false"),
});
export type OptionInput = z.input<typeof optionSchema>;

export const optionsSchema = z.array(optionSchema, "Options must be a list");

type RuleInput = {
  type: QuestionType;
  defaultMarks: number;
  negativeMarks: number;
  options: { text: string; isCorrect: boolean }[];
};

/**
 * Cross-field rules. Per-type option problems are reported on the `options` path,
 * marks problems on `negativeMarks`. Exported so the import can reuse them.
 */
export function checkQuestionRules(question: RuleInput, ctx: z.RefinementCtx) {
  const { type, options } = question;
  const correct = options.filter((option) => option.isCorrect).length;
  const optionsIssue = (message: string) => ctx.addIssue({ code: "custom", path: ["options"], message });

  if (type === "WRITTEN") {
    if (options.length > 0) optionsIssue("Written questions have no options");
    if (question.negativeMarks > 0) {
      ctx.addIssue({ code: "custom", path: ["negativeMarks"], message: "Written questions cannot have negative marks" });
    }
  } else {
    if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
      optionsIssue(`Add between ${MIN_OPTIONS} and ${MAX_OPTIONS} options`);
    } else if (type === "MCQ" && correct !== 1) {
      optionsIssue("Mark exactly one option as correct");
    } else if (type === "MULTI" && correct < 1) {
      optionsIssue("Mark at least one option as correct");
    }
    const seen = new Set<string>();
    for (const option of options) {
      const key = option.text.trim().toLowerCase();
      if (key && seen.has(key)) {
        optionsIssue(`Duplicate option: "${option.text.trim()}"`);
        break;
      }
      seen.add(key);
    }
  }

  if (question.negativeMarks > question.defaultMarks) {
    ctx.addIssue({ code: "custom", path: ["negativeMarks"], message: "Negative marks cannot exceed the marks" });
  }
}

/** POST /api/questions (and the fully merged result of a PATCH). */
export const questionInputSchema = z
  .object({
    topic: topicSchema,
    difficulty: difficultySchema.default("MEDIUM"),
    type: questionTypeSchema,
    text: questionTextSchema,
    defaultMarks: defaultMarksSchema,
    negativeMarks: negativeMarksSchema.default(0),
    multiScheme: multiSchemeSchema.default("ALL_OR_NOTHING"),
    options: optionsSchema.default([]),
  })
  .superRefine(checkQuestionRules);
export type QuestionInput = z.input<typeof questionInputSchema>;
export type QuestionData = z.output<typeof questionInputSchema>;

/**
 * PATCH /api/questions/:id - any subset (no defaults, so omitted fields stay untouched).
 * `options`, when sent, replaces the whole list. Type rules run on the merged result.
 */
export const updateQuestionSchema = z
  .object({
    topic: topicSchema,
    difficulty: difficultySchema,
    type: questionTypeSchema,
    text: questionTextSchema,
    defaultMarks: defaultMarksSchema,
    negativeMarks: negativeMarksSchema,
    multiScheme: multiSchemeSchema,
    options: optionsSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateQuestionInput = z.input<typeof updateQuestionSchema>;

export const listQuestionsQuerySchema = z.object({
  search: z.string().trim().max(200).optional().default(""),
  topic: z.string().trim().max(100).optional().default(""),
  difficulty: z.enum(DIFFICULTIES).optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuestionsQuery = z.output<typeof listQuestionsQuerySchema>;

export type OptionDto = { id: string; text: string; isCorrect: boolean; order: number };

/** Owner (examiner/admin) view of a bank question - includes `isCorrect`. */
export type QuestionDto = {
  id: string;
  topic: string;
  difficulty: Difficulty;
  type: QuestionType;
  text: string;
  defaultMarks: number;
  negativeMarks: number;
  multiScheme: MultiScheme;
  options: OptionDto[];
  /** Number of exams this question is assigned to. */
  usedInExams: number;
  createdAt: string;
  createdBy: { id: string; name: string };
};

export type QuestionDetailDto = QuestionDto & {
  exams: { id: string; title: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED" }[];
};

export type QuestionListResponse = {
  items: QuestionDto[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
