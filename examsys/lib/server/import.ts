import { randomInt, randomUUID } from "node:crypto";
import { Prisma, Role, type Exam } from "@prisma/client";
import Papa from "papaparse";
import type { ZodError } from "zod";
import { conflict } from "@/lib/api/errors";
import { AppError } from "@/lib/errors";
import { assertExamOwner } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
import { addEnrollments } from "@/lib/server/enrollments";
import { canonicalKeys, isObject, requireColumns, type ImportSource } from "@/lib/server/import-file";
import { deriveExamPhase } from "@/lib/services/exam-lifecycle";
import { ENROLL_MAX_ENTRIES } from "@/lib/validation/enrollments";
import {
  CANDIDATE_COLUMNS,
  CANDIDATE_REQUIRED_COLUMNS,
  OPTION_LETTERS,
  QUESTION_COLUMNS,
  QUESTION_REQUIRED_COLUMNS,
  candidateRowSchema,
  type CandidateRow,
  type ImportReport,
  type ImportRowResult,
} from "@/lib/validation/import";
import { questionInputSchema, type QuestionData } from "@/lib/validation/questions";

type Session = { userId: string; role: Role };
type Options = { dryRun: boolean };

/** Rows written per statement / batch transaction. */
const USER_BATCH = 500;
const QUESTION_BATCH = 200;

/* ------------------------------------------------------------------ helpers */

/** Plain value -> string ("" for missing) so zod reports the field's own message. */
function text(value: unknown): unknown {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return value;
}

/** Number from a CSV cell or JSON value; a non-numeric string is passed through for zod to reject. */
function numeric(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (value === undefined || value === null) return undefined;
  const raw = String(value).trim();
  if (raw === "") return undefined;
  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

/** Upper-cased enum value; empty -> undefined (the schema default applies). */
function enumValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.toUpperCase();
}

function formatIssues(error: ZodError, rename: (path: PropertyKey[]) => string): string[] {
  const seen = new Set<string>();
  for (const issue of error.issues) seen.add(`${rename(issue.path)}: ${issue.message}`);
  return [...seen];
}

const truncate = (value: string, max = 100) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const plain = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

function summary(rows: ImportRowResult[], dryRun: boolean): Omit<ImportReport, "rows"> {
  const invalid = rows.filter((row) => row.status === "invalid").length;
  return {
    dryRun,
    total: rows.length,
    valid: rows.length - invalid,
    invalid,
    imported: rows.filter((row) => row.status === "imported").length,
  };
}

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** Same rule as POST /api/exams/:id/enrollments, checked BEFORE any user is created. */
function assertEnrollmentOpen(exam: Exam) {
  const phase = deriveExamPhase(exam, new Date());
  if (exam.resultsPublishedAt) throw conflict("Results are already published; enrollment is closed");
  if (phase === "COMPLETED") throw conflict("This exam has ended; enrollment is closed");
  if (phase === "ARCHIVED") throw conflict("This exam is archived; enrollment is closed");
}

const PASSWORD_SETS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "@#%+=?!"];
const PASSWORD_LENGTH = 14;

/** Random 14-character password with upper, lower, digit and symbol (no look-alike characters). */
export function generatePassword(): string {
  const all = PASSWORD_SETS.join("");
  const chars = PASSWORD_SETS.map((set) => set[randomInt(set.length)]);
  while (chars.length < PASSWORD_LENGTH) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/* --------------------------------------------------------------- candidates */

type CandidateCheck = { result: ImportRowResult; data?: CandidateRow };

/**
 * Validates every row (same name/email/password rules as the users API), rejects
 * duplicate emails within the file and against existing accounts, then (unless
 * `dryRun`) creates the valid rows as CANDIDATE users. Passwords left blank are
 * generated and returned ONCE as `credentialsCsv`. With `examId` (which the caller
 * must own) the new users are enrolled through the normal enrollment service.
 */
export async function importCandidates(source: ImportSource, { dryRun }: Options, session: Session): Promise<ImportReport> {
  if (source.examId) assertEnrollmentOpen(await assertExamOwner(source.examId, session.userId, session.role));
  requireColumns(source.headers, CANDIDATE_REQUIRED_COLUMNS, CANDIDATE_COLUMNS);

  const firstRowByEmail = new Map<string, number>();
  const checks: CandidateCheck[] = source.records.map((record, index) => {
    const row = index + 1;
    const errors = [...(source.parseErrors.get(index) ?? [])];
    if (!isObject(record)) {
      return { result: { row, status: "invalid", errors: [...errors, "row: Expected an object with name, email, rollNo, password"], label: "" } };
    }
    const values = canonicalKeys(record, CANDIDATE_COLUMNS);
    const label = [plain(values.name), plain(values.email) && `<${plain(values.email)}>`].filter(Boolean).join(" ");
    const password = text(values.password);
    const parsed = candidateRowSchema.safeParse({
      name: text(values.name),
      email: text(values.email),
      rollNo: values.rollNo === undefined || values.rollNo === null ? undefined : text(values.rollNo),
      password: password === "" ? undefined : password,
    });
    if (!parsed.success) errors.push(...formatIssues(parsed.error, (path) => path.join(".") || "row"));

    if (parsed.success) {
      const first = firstRowByEmail.get(parsed.data.email);
      if (first !== undefined) errors.push(`email: Same email as row ${first}`);
      else firstRowByEmail.set(parsed.data.email, row);
    }
    return {
      result: { row, status: errors.length ? "invalid" : "valid", errors, label },
      data: errors.length || !parsed.success ? undefined : parsed.data,
    };
  });

  const candidates = checks.filter((check) => check.data);
  if (candidates.length > 0) {
    const existing = await prisma.user.findMany({
      where: { email: { in: candidates.map((check) => check.data!.email), mode: "insensitive" } },
      select: { email: true },
    });
    const taken = new Set(existing.map((user) => user.email.toLowerCase()));
    for (const check of candidates) {
      if (taken.has(check.data!.email)) rejectRow(check, "email: A user with this email already exists");
    }
  }

  const rows = checks.map((check) => check.result);
  const toCreate = checks.filter((check) => check.data);
  if (dryRun) return { ...summary(rows, true), rows };

  // Hash (bcrypt, M1's cost) and create; the unique email index settles any race.
  const generated = new Map<string, string>();
  const prepared = await Promise.all(
    toCreate.map(async (check) => {
      const data = check.data!;
      let password = data.password;
      if (!password) {
        password = generatePassword();
        generated.set(data.email, password);
      }
      return {
        check,
        user: { name: data.name, email: data.email, rollNo: data.rollNo ?? null, role: Role.CANDIDATE, passwordHash: await hashPassword(password) },
      };
    }),
  );

  const createdIds: string[] = [];
  for (const batch of chunk(prepared, USER_BATCH)) {
    const created = await prisma.user.createManyAndReturn({
      data: batch.map((item) => item.user),
      select: { id: true, email: true },
      skipDuplicates: true,
    });
    const idByEmail = new Map(created.map((user) => [user.email, user.id]));
    for (const { check, user } of batch) {
      const id = idByEmail.get(user.email);
      if (id) {
        check.result.status = "imported";
        createdIds.push(id);
      } else {
        rejectRow(check, "email: A user with this email already exists");
        generated.delete(user.email);
      }
    }
  }

  const report: ImportReport = { ...summary(rows, false), rows };
  if (generated.size > 0) {
    report.credentialsCsv = `${Papa.unparse({ fields: ["email", "password"], data: [...generated].map(([email, pw]) => [email, pw]) }, { newline: "\n" })}\n`;
  }

  if (source.examId && createdIds.length > 0) {
    const enrollment: NonNullable<ImportReport["enrollment"]> = { added: 0, alreadyEnrolled: 0, rejected: [] };
    try {
      for (const ids of chunk(createdIds, ENROLL_MAX_ENTRIES)) {
        const outcome = await addEnrollments(source.examId, { userIds: ids, emails: [] }, session);
        enrollment.added += outcome.added;
        enrollment.alreadyEnrolled += outcome.alreadyEnrolled;
        enrollment.rejected.push(...outcome.rejected);
      }
    } catch (error) {
      // The accounts exist now (and their credentials must reach the caller), so report instead of failing.
      if (!(error instanceof AppError)) throw error;
      enrollment.rejected.push({ value: source.examId, reason: error.message });
    }
    report.enrollment = enrollment;
  }

  await prisma.auditLog.create({
    data: {
      actorId: session.userId,
      action: "import.candidates",
      entity: "User",
      entityId: source.examId ?? null,
      meta: {
        total: report.total,
        imported: report.imported,
        invalid: report.invalid,
        generatedPasswords: generated.size,
        ...(source.examId ? { examId: source.examId, enrolled: report.enrollment?.added ?? 0 } : {}),
      },
    },
  });
  return report;
}

function rejectRow(check: { result: ImportRowResult; data?: unknown }, error: string) {
  check.result.errors.push(error);
  check.result.status = "invalid";
  check.data = undefined;
}

/* ---------------------------------------------------------------- questions */

type QuestionCheck = { result: ImportRowResult; data?: QuestionData };

/** CSV row -> questionInputSchema input, plus the problems only the CSV form can have. */
function questionFromCsv(values: Record<string, unknown>) {
  const errors: string[] = [];
  const options: { text: string; isCorrect: boolean }[] = [];
  const indexByLetter = new Map<string, number>();
  const letterByIndex: string[] = [];
  for (const letter of OPTION_LETTERS) {
    const optionText = plain(values[`option${letter}`]);
    if (!optionText) continue;
    indexByLetter.set(letter, options.length);
    letterByIndex.push(letter);
    options.push({ text: optionText, isCorrect: false });
  }

  const type = enumValue(values.type);
  const correct = [...new Set(plain(values.correct).split(/[\s;,|]+/).filter(Boolean).map((letter) => letter.toUpperCase()))];
  for (const letter of correct) {
    const index = indexByLetter.get(letter);
    if (index !== undefined) options[index].isCorrect = true;
    else if ((OPTION_LETTERS as readonly string[]).includes(letter)) errors.push(`correct: option${letter} is empty`);
    else errors.push(`correct: "${letter}" is not an option letter (A-F)`);
  }
  if (type === "WRITTEN" && correct.length > 0) errors.push("correct: Written questions have no correct answer");
  if ((type === "MCQ" || type === "MULTI") && correct.length === 0) {
    errors.push("correct: Give the correct option letter(s), e.g. A or A;C");
  }

  const input = {
    topic: text(values.topic),
    difficulty: enumValue(values.difficulty),
    type,
    text: text(values.text),
    defaultMarks: numeric(values.marks),
    negativeMarks: numeric(values.negativeMarks),
    multiScheme: enumValue(values.multiScheme),
    options,
  };
  const rename = (path: PropertyKey[]) => {
    if (path[0] === "defaultMarks") return "marks";
    if (path[0] === "options" && typeof path[1] === "number") return `option${letterByIndex[path[1]] ?? path[1]}`;
    return path.join(".") || "row";
  };
  return { input, errors, rename };
}

/** JSON row: `{ topic, difficulty, type, text, marks, negativeMarks?, multiScheme?, options: [{ text, isCorrect }] }`. */
function questionFromJson(values: Record<string, unknown>) {
  const input = {
    topic: text(values.topic),
    difficulty: enumValue(values.difficulty),
    type: enumValue(values.type),
    text: text(values.text),
    defaultMarks: numeric(values.marks ?? values.defaultMarks),
    negativeMarks: numeric(values.negativeMarks),
    multiScheme: enumValue(values.multiScheme),
    options: values.options ?? [],
  };
  const rename = (path: PropertyKey[]) => (path[0] === "defaultMarks" ? "marks" : path.join(".") || "row");
  return { input, errors: [] as string[], rename };
}

/**
 * Maps each row onto PR 2's `questionInputSchema` (so the exact question-bank rules
 * apply), rejects duplicates within the file and questions already in the caller's
 * bank (same type + text), then (unless `dryRun`) creates the valid rows owned by the caller.
 */
export async function importQuestions(source: ImportSource, { dryRun }: Options, session: Session): Promise<ImportReport> {
  requireColumns(source.headers, QUESTION_REQUIRED_COLUMNS, QUESTION_COLUMNS);

  const firstRowByKey = new Map<string, number>();
  const checks: QuestionCheck[] = source.records.map((record, index) => {
    const row = index + 1;
    const errors = [...(source.parseErrors.get(index) ?? [])];
    if (!isObject(record)) {
      return { result: { row, status: "invalid", errors: [...errors, "row: Expected an object describing a question"], label: "" } };
    }
    const values = canonicalKeys(record, [...QUESTION_COLUMNS, "defaultMarks", "options"]);
    const mapped = source.headers ? questionFromCsv(values) : questionFromJson(values);
    errors.push(...mapped.errors);
    const typeLabel = typeof mapped.input.type === "string" && mapped.input.type ? `[${mapped.input.type}] ` : "";
    const label = truncate(`${typeLabel}${plain(values.text)}`);

    const parsed = questionInputSchema.safeParse(mapped.input);
    if (!parsed.success) errors.push(...formatIssues(parsed.error, mapped.rename));
    if (parsed.success && errors.length === 0) {
      const key = `${parsed.data.type}|${parsed.data.text.toLowerCase()}`;
      const first = firstRowByKey.get(key);
      if (first !== undefined) errors.push(`text: Same question as row ${first}`);
      else firstRowByKey.set(key, row);
    }
    return {
      result: { row, status: errors.length ? "invalid" : "valid", errors, label },
      data: errors.length || !parsed.success ? undefined : parsed.data,
    };
  });

  const candidates = checks.filter((check) => check.data);
  if (candidates.length > 0) {
    const existing = await prisma.question.findMany({
      where: { createdById: session.userId, text: { in: candidates.map((check) => check.data!.text), mode: "insensitive" } },
      select: { type: true, text: true },
    });
    const taken = new Set(existing.map((question) => `${question.type}|${question.text.toLowerCase()}`));
    for (const check of candidates) {
      if (taken.has(`${check.data!.type}|${check.data!.text.toLowerCase()}`)) {
        rejectRow(check, "text: This question is already in your bank");
      }
    }
  }

  const rows = checks.map((check) => check.result);
  const toCreate = checks.filter((check) => check.data);
  if (dryRun) return { ...summary(rows, true), rows };

  // Ids are generated here so a whole batch (questions + options) is two statements in one
  // transaction. createdAt steps back 1 ms per row so the bank (newest first) lists row 1 first.
  const now = Date.now();
  for (const [batchIndex, batch] of chunk(toCreate, QUESTION_BATCH).entries()) {
    const questions: Prisma.QuestionCreateManyInput[] = [];
    const options: Prisma.OptionCreateManyInput[] = [];
    batch.forEach((check, index) => {
      const data = check.data!;
      const id = randomUUID();
      questions.push({
        id,
        topic: data.topic,
        difficulty: data.difficulty,
        type: data.type,
        text: data.text,
        defaultMarks: data.defaultMarks,
        negativeMarks: data.negativeMarks,
        multiScheme: data.multiScheme,
        createdById: session.userId,
        createdAt: new Date(now - (batchIndex * QUESTION_BATCH + index)),
      });
      data.options.forEach((option, order) =>
        options.push({ questionId: id, text: option.text, isCorrect: option.isCorrect, order: order + 1 }),
      );
    });
    await prisma.$transaction([
      prisma.question.createMany({ data: questions }),
      ...(options.length ? [prisma.option.createMany({ data: options })] : []),
    ]);
    for (const check of batch) check.result.status = "imported";
  }

  const report: ImportReport = { ...summary(rows, false), rows };
  await prisma.auditLog.create({
    data: {
      actorId: session.userId,
      action: "import.questions",
      entity: "Question",
      entityId: null,
      meta: { total: report.total, imported: report.imported, invalid: report.invalid },
    },
  });
  return report;
}
