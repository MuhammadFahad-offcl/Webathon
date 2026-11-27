import { ExamStatus, Prisma, QuestionType, Role } from "@prisma/client";
import { assertExamOwner } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { conflict, notFound, validation } from "@/lib/api/errors";
import { deriveExamPhase } from "@/lib/services/exam-lifecycle";
import {
  ALWAYS_EDITABLE_FIELDS,
  START_IN_PAST_MESSAGE,
  scheduleIssues,
  windowMinutes,
  type AssignQuestionsData,
  type CreateExamData,
  type ExamDetail,
  type ExamPhaseName,
  type ExamSummary,
  type ListExamsQuery,
  type PublishCheck,
  type UpdateExamData,
} from "@/lib/validation/exams";

/**
 * Exam management for examiners and admins (Member 2, Phase B).
 * Ownership: examiners only ever reach their own exams (others -> 404 via M1's
 * `assertExamOwner`); admins reach all. Every attempt count filters `isSandbox: false`,
 * so an examiner's sandbox preview never locks an exam or shows up in a count.
 */

type Session = { userId: string; role: Role };

const REAL_ATTEMPTS = { isSandbox: false } satisfies Prisma.AttemptWhereInput;

const summaryInclude = {
  createdBy: { select: { id: true, name: true } },
  _count: { select: { questions: true, enrollments: true, attempts: { where: REAL_ATTEMPTS } } },
} satisfies Prisma.ExamInclude;

const detailInclude = {
  ...summaryInclude,
  questions: {
    orderBy: [{ order: "asc" }, { id: "asc" }],
    select: {
      questionId: true,
      order: true,
      marks: true,
      question: {
        select: {
          type: true,
          topic: true,
          difficulty: true,
          text: true,
          options: { select: { isCorrect: true } },
        },
      },
    },
  },
} satisfies Prisma.ExamInclude;

type SummaryRow = Prisma.ExamGetPayload<{ include: typeof summaryInclude }>;
type DetailRow = Prisma.ExamGetPayload<{ include: typeof detailInclude }>;

const auditTx = { maxWait: 10_000, timeout: 20_000 }; // slow link: see lib/server/users.ts

function toSummary(exam: SummaryRow, now: Date): ExamSummary {
  return {
    id: exam.id,
    title: exam.title,
    status: exam.status,
    phase: deriveExamPhase(exam, now) as ExamPhaseName,
    startAt: exam.startAt.toISOString(),
    endAt: exam.endAt.toISOString(),
    durationMin: exam.durationMin,
    totalMarks: exam.totalMarks,
    questionCount: exam._count.questions,
    enrolledCount: exam._count.enrollments,
    attemptCount: exam._count.attempts,
    resultsPublishedAt: exam.resultsPublishedAt?.toISOString() ?? null,
    createdBy: exam.createdBy,
  };
}

/**
 * Why an exam can no longer change beyond its title and instructions, or null.
 * Exams are never unpublished, so an UPCOMING exam without attempts stays editable.
 */
export function lockReasonFor(
  exam: { status: ExamStatus; startAt: Date; endAt: Date; resultsPublishedAt: Date | null },
  realAttemptCount: number,
  now: Date,
): string | null {
  if (exam.resultsPublishedAt) return "Results have been published.";
  const phase = deriveExamPhase(exam, now);
  if (phase === "ARCHIVED") return "The exam is archived.";
  if (phase === "COMPLETED") return "The exam has ended.";
  if (phase === "ONGOING") return "The exam is in progress.";
  if (realAttemptCount > 0) return "Candidates have already started this exam.";
  return null;
}

function toDetail(exam: DetailRow, now: Date): ExamDetail {
  const lockReason = lockReasonFor(exam, exam._count.attempts, now);
  return {
    ...toSummary(exam, now),
    instructions: exam.instructions,
    shuffleQuestions: exam.shuffleQuestions,
    shuffleOptions: exam.shuffleOptions,
    locked: lockReason !== null,
    lockReason,
    questions: exam.questions.map((row) => ({
      questionId: row.questionId,
      order: row.order,
      marks: row.marks,
      type: row.question.type,
      topic: row.question.topic,
      difficulty: row.question.difficulty,
      text: row.question.text,
      optionCount: row.question.options.length,
    })),
  };
}

async function loadDetailRow(id: string) {
  const exam = await prisma.exam.findUnique({ where: { id }, include: detailInclude });
  if (!exam) throw notFound("Exam");
  return exam;
}

// ---- Queries ------------------------------------------------------------------------------

/** Newest first. The phase filter is applied after deriving the phase from server time. */
export async function listExams(session: Session, query: ListExamsQuery): Promise<{ items: ExamSummary[] }> {
  const where: Prisma.ExamWhereInput = {};
  if (session.role !== Role.ADMIN) where.createdById = session.userId;
  if (query.search) where.title = { contains: query.search, mode: "insensitive" };
  // Narrow by stored status where the phase implies it; the rest is decided below.
  if (query.phase === "DRAFT" || query.phase === "ARCHIVED") where.status = query.phase;
  else if (query.phase) where.status = ExamStatus.PUBLISHED;

  const rows = await prisma.exam.findMany({
    where,
    include: summaryInclude,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 500,
  });
  const now = new Date();
  const items = rows.map((row) => toSummary(row, now));
  return { items: query.phase ? items.filter((item) => item.phase === query.phase) : items };
}

export async function getExam(id: string, session: Session): Promise<ExamDetail> {
  await assertExamOwner(id, session.userId, session.role);
  return toDetail(await loadDetailRow(id), new Date());
}

// ---- Mutations ----------------------------------------------------------------------------

export async function createExam(input: CreateExamData, session: Session): Promise<ExamDetail> {
  const exam = await prisma.$transaction(
    async (tx) => {
      const created = await tx.exam.create({
        data: {
          title: input.title,
          instructions: input.instructions,
          startAt: input.startAt,
          endAt: input.endAt,
          durationMin: input.durationMin,
          shuffleQuestions: input.shuffleQuestions,
          shuffleOptions: input.shuffleOptions,
          status: ExamStatus.DRAFT,
          createdById: session.userId,
        },
        include: detailInclude,
      });
      await tx.auditLog.create({
        data: { actorId: session.userId, action: "exam.create", entity: "Exam", entityId: created.id, meta: { title: created.title } },
      });
      return created;
    },
    auditTx,
  );
  return toDetail(exam, new Date());
}

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/**
 * Partial update. Only fields whose value actually changes count, so a form that sends
 * every field still works on a locked exam as long as only title/instructions differ.
 */
export async function updateExam(id: string, input: UpdateExamData, session: Session): Promise<ExamDetail> {
  const current = await assertExamOwner(id, session.userId, session.role);
  const now = new Date();

  const changes: Partial<UpdateExamData> = {};
  for (const [key, value] of Object.entries(input) as [keyof UpdateExamData, unknown][]) {
    if (value !== undefined && !sameValue(value, current[key])) (changes as Record<string, unknown>)[key] = value;
  }
  const changed = Object.keys(changes) as (keyof UpdateExamData)[];
  if (changed.length === 0) return toDetail(await loadDetailRow(id), now);

  const restricted = changed.filter((key) => !(ALWAYS_EDITABLE_FIELDS as readonly string[]).includes(key));
  if (restricted.length > 0) {
    const attempts = await prisma.attempt.count({ where: { examId: id, ...REAL_ATTEMPTS } });
    const reason = lockReasonFor(current, attempts, now);
    if (reason) {
      throw conflict(`${reason} Only the title and instructions can be changed now.`, { lockedFields: restricted });
    }

    const merged = {
      startAt: changes.startAt ?? current.startAt,
      endAt: changes.endAt ?? current.endAt,
      durationMin: changes.durationMin ?? current.durationMin,
    };
    const fields = scheduleIssues(merged);
    if (changes.startAt && changes.startAt.getTime() <= now.getTime()) fields.startAt = START_IN_PAST_MESSAGE;
    if (Object.keys(fields).length > 0) throw validation("The schedule is not valid", fields);
  }

  await prisma.$transaction([
    prisma.exam.update({ where: { id }, data: changes }),
    prisma.auditLog.create({
      data: { actorId: session.userId, action: "exam.update", entity: "Exam", entityId: id, meta: { changed } },
    }),
  ]);
  return toDetail(await loadDetailRow(id), now);
}

/**
 * Replaces the exam's question list and recomputes `Exam.totalMarks` in the same transaction.
 * Every question must exist and, for an examiner, be one they created.
 */
export async function assignQuestions(id: string, input: AssignQuestionsData, session: Session): Promise<ExamDetail> {
  const exam = await assertExamOwner(id, session.userId, session.role);
  const now = new Date();
  const ids = input.items.map((item) => item.questionId);

  const [attempts, questions] = await Promise.all([
    prisma.attempt.count({ where: { examId: id, ...REAL_ATTEMPTS } }),
    ids.length
      ? prisma.question.findMany({ where: { id: { in: ids } }, select: { id: true, createdById: true } })
      : Promise.resolve([]),
  ]);
  const reason = lockReasonFor(exam, attempts, now);
  if (reason) throw conflict(`${reason} The question list can no longer be changed.`);

  const usable = new Set(
    questions.filter((q) => session.role === Role.ADMIN || q.createdById === session.userId).map((q) => q.id),
  );
  const unusable = ids.filter((questionId) => !usable.has(questionId));
  if (unusable.length > 0) {
    throw validation("Some questions can't be added", {
      items: `${unusable.length} question${unusable.length === 1 ? " was" : "s were"} not found in your question bank`,
    });
  }

  const totalMarks = Math.round(input.items.reduce((sum, item) => sum + item.marks, 0) * 100) / 100;
  await prisma.$transaction([
    prisma.examQuestion.deleteMany({ where: { examId: id } }),
    prisma.examQuestion.createMany({
      data: input.items.map((item) => ({ examId: id, questionId: item.questionId, marks: item.marks, order: item.order })),
    }),
    prisma.exam.update({ where: { id }, data: { totalMarks } }),
    prisma.auditLog.create({
      data: {
        actorId: session.userId,
        action: "exam.questions.assign",
        entity: "Exam",
        entityId: id,
        meta: { questionCount: input.items.length, totalMarks },
      },
    }),
  ]);
  return toDetail(await loadDetailRow(id), now);
}

// ---- Review before publish ----------------------------------------------------------------

function computePublishCheck(exam: DetailRow, now: Date): PublishCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const questionCount = exam.questions.length;
  const marksSum = Math.round(exam.questions.reduce((sum, row) => sum + row.marks, 0) * 100) / 100;

  if (exam.status !== ExamStatus.DRAFT) blockers.push("This exam is already published.");
  if (questionCount === 0) blockers.push("Add at least one question.");

  const schedule = scheduleIssues(exam);
  if (schedule.endAt) blockers.push(`Schedule: ${schedule.endAt}.`);
  if (schedule.durationMin) blockers.push(`Schedule: ${schedule.durationMin}.`);
  if (exam.startAt.getTime() <= now.getTime()) {
    blockers.push("The start time is in the past. Move it to a future time.");
  }

  exam.questions.forEach((row, index) => {
    const { type, options } = row.question;
    if (type === QuestionType.WRITTEN) return;
    const label = `Question ${index + 1} (${type})`;
    if (options.length < 2) blockers.push(`${label} has fewer than 2 options.`);
    else if (!options.some((option) => option.isCorrect)) blockers.push(`${label} has no correct option.`);
  });

  if (questionCount > 0 && Math.abs(marksSum - exam.totalMarks) > 0.001) {
    blockers.push(`Total marks (${exam.totalMarks}) don't match the question marks (${marksSum}). Save the question list again.`);
  }

  if (exam._count.enrollments === 0) {
    warnings.push("No candidates are enrolled yet. You can still enroll them after publishing.");
  }
  if (!schedule.endAt && !schedule.durationMin) {
    const window = windowMinutes(exam.startAt, exam.endAt);
    if (window >= exam.durationMin * 2 && window - exam.durationMin >= 30) {
      warnings.push(
        `The window (${window} min) is much longer than the duration (${exam.durationMin} min): candidates can start at different times.`,
      );
    }
    const minutesToStart = (exam.startAt.getTime() - now.getTime()) / 60_000;
    if (minutesToStart > 0 && minutesToStart < 15) warnings.push("The exam starts in less than 15 minutes.");
  }
  const written = exam.questions.filter((row) => row.question.type === QuestionType.WRITTEN).length;
  if (written > 0) {
    warnings.push(`${written} written question${written === 1 ? "" : "s"} will need manual grading.`);
  }
  if (!exam.instructions.trim()) warnings.push("There are no instructions for candidates.");
  if (exam.shuffleOptions && exam.questions.every((row) => row.question.type === QuestionType.WRITTEN) && questionCount > 0) {
    warnings.push("Shuffle options is on, but every question is written.");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    summary: {
      questionCount,
      totalMarks: exam.totalMarks,
      enrolledCount: exam._count.enrollments,
      startAt: exam.startAt.toISOString(),
      endAt: exam.endAt.toISOString(),
      durationMin: exam.durationMin,
    },
  };
}

export async function getPublishCheck(id: string, session: Session): Promise<PublishCheck> {
  await assertExamOwner(id, session.userId, session.role);
  return computePublishCheck(await loadDetailRow(id), new Date());
}

/**
 * DRAFT -> PUBLISHED when the publish check has no blockers. The status flip is a guarded
 * `updateMany ... where status = DRAFT`, so two concurrent publishes can't both succeed.
 */
export async function publishExam(id: string, session: Session): Promise<{ exam: ExamDetail; warnings: string[] }> {
  await assertExamOwner(id, session.userId, session.role);
  const now = new Date();
  const check = computePublishCheck(await loadDetailRow(id), now);
  if (!check.ready) throw conflict("This exam can't be published yet", { blockers: check.blockers });

  await prisma.$transaction(async (tx) => {
    const result = await tx.exam.updateMany({ where: { id, status: ExamStatus.DRAFT }, data: { status: ExamStatus.PUBLISHED } });
    if (result.count === 0) throw conflict("This exam can't be published yet", { blockers: ["This exam is already published."] });
    await tx.auditLog.create({
      data: {
        actorId: session.userId,
        action: "exam.publish",
        entity: "Exam",
        entityId: id,
        meta: { questionCount: check.summary.questionCount, totalMarks: check.summary.totalMarks, warnings: check.warnings },
      },
    });
  }, auditTx);

  return { exam: toDetail(await loadDetailRow(id), new Date()), warnings: check.warnings };
}
