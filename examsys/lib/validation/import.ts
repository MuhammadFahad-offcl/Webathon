import { z } from "zod";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@/lib/constants";
import { emailSchema, nameSchema, passwordSchema, rollNoSchema } from "@/lib/validation/users";

/**
 * Bulk import (POST /api/import/candidates, POST /api/import/questions).
 * Shared by the import routes and the examiner import dialog.
 */

export { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS };

export const IMPORT_KINDS = ["candidates", "questions"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const CANDIDATE_COLUMNS = ["name", "email", "rollNo", "password"] as const;
export const CANDIDATE_REQUIRED_COLUMNS = ["name", "email"] as const;

export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
export const QUESTION_COLUMNS = [
  "topic",
  "difficulty",
  "type",
  "text",
  "marks",
  ...OPTION_LETTERS.map((letter) => `option${letter}` as const),
  "correct",
  "negativeMarks",
  "multiScheme",
] as const;
export const QUESTION_REQUIRED_COLUMNS = ["topic", "type", "text", "marks"] as const;

/** One candidate row; the same name/email/password rules as the admin users API. */
export const candidateRowSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  rollNo: rollNoSchema,
  password: passwordSchema.optional(),
});
export type CandidateRow = z.output<typeof candidateRowSchema>;

/** `?dryRun=true` (or `1`) validates only. */
export const importQuerySchema = z.object({
  dryRun: z
    .enum(["true", "false", "1", "0"], "dryRun must be true or false")
    .optional()
    .transform((value) => value === "true" || value === "1"),
});

export const examIdSchema = z.string().trim().min(1, "examId is required").max(100).optional();

export type ImportRowStatus = "valid" | "invalid" | "imported";

export type ImportRowResult = {
  /** 1-based data row (header excluded). */
  row: number;
  status: ImportRowStatus;
  /** "field: reason" strings; empty when the row is fine. */
  errors: string[];
  /** Short human summary of the row for the preview table (e.g. "Ali Khan <ali@x.com>"). */
  label: string;
};

export type ImportReport = {
  dryRun: boolean;
  total: number;
  valid: number;
  invalid: number;
  imported: number;
  rows: ImportRowResult[];
  /** Real candidate import that generated passwords only; returned once. */
  credentialsCsv?: string;
  /** Candidate import with `examId` (real import only): outcome of the enrollment. */
  enrollment?: { added: number; alreadyEnrolled: number; rejected: { value: string; reason: string }[] };
};
