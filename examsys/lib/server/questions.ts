import { ExamStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { REAL_ATTEMPT } from "@/lib/server/attempt-scope";
import { conflict, notFound } from "@/lib/api/errors";
import {
  questionInputSchema,
  type ListQuestionsQuery,
  type QuestionData,
  type QuestionDetailDto,
  type QuestionDto,
  type QuestionListResponse,
  type updateQuestionSchema,
} from "@/lib/validation/questions";
import type { z } from "zod";

type Actor = { userId: string; role: Role };

/** Interactive transactions need headroom on a slow database link (~1 s per round trip). */
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

const MAX_TEXT = 5000;

export const questionInclude = {
  options: { orderBy: { order: "asc" }, select: { id: true, text: true, isCorrect: true, order: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { examQuestions: true } },
} satisfies Prisma.QuestionInclude;

type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof questionInclude }>;

export function toQuestionDto(row: QuestionRow): QuestionDto {
  return {
    id: row.id,
    topic: row.topic,
    difficulty: row.difficulty,
    type: row.type,
    text: row.text,
    defaultMarks: row.defaultMarks,
    negativeMarks: row.negativeMarks,
    multiScheme: row.multiScheme,
    options: row.options,
    usedInExams: row._count.examQuestions,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/** Examiners only ever see their own questions; admins see all. */
export function visibleQuestions(actor: Actor): Prisma.QuestionWhereInput {
  return actor.role === Role.ADMIN ? {} : { createdById: actor.userId };
}

async function findOwned(id: string, actor: Actor, db: Prisma.TransactionClient = prisma) {
  const question = await db.question.findFirst({
    where: { id, ...visibleQuestions(actor) },
    include: {
      ...questionInclude,
      examQuestions: { select: { exam: { select: { id: true, title: true, status: true } } } },
    },
  });
  if (!question) throw notFound("Question");
  return question;
}

const optionRows = (options: QuestionData["options"]) =>
  options.map((option, index) => ({ text: option.text, isCorrect: option.isCorrect, order: index + 1 }));

function audit(
  db: Prisma.TransactionClient,
  actorId: string,
  action: string,
  entityId: string,
  meta: Prisma.InputJsonValue,
) {
  return db.auditLog.create({ data: { actorId, action, entity: "Question", entityId, meta } });
}

export async function listQuestions(query: ListQuestionsQuery, actor: Actor): Promise<QuestionListResponse> {
  const where: Prisma.QuestionWhereInput = { ...visibleQuestions(actor) };
  if (query.topic) where.topic = { equals: query.topic, mode: "insensitive" };
  if (query.difficulty) where.difficulty = query.difficulty;
  if (query.type) where.type = query.type;
  if (query.search) {
    where.OR = [
      { text: { contains: query.search, mode: "insensitive" } },
      { topic: { contains: query.search, mode: "insensitive" } },
    ];
  }
  const [total, rows] = await prisma.$transaction([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      include: questionInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    items: rows.map(toQuestionDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function listTopics(actor: Actor): Promise<string[]> {
  const rows = await prisma.question.findMany({
    where: visibleQuestions(actor),
    distinct: ["topic"],
    select: { topic: true },
    orderBy: { topic: "asc" },
  });
  return rows.map((row) => row.topic);
}

export async function getQuestion(id: string, actor: Actor): Promise<QuestionDetailDto> {
  const { examQuestions, ...row } = await findOwned(id, actor);
  return { ...toQuestionDto(row), exams: examQuestions.map((eq) => eq.exam) };
}

export async function createQuestion(input: QuestionData, actorId: string): Promise<QuestionDto> {
  return prisma.$transaction(async (tx) => {
    const question = await tx.question.create({
      data: {
        topic: input.topic,
        difficulty: input.difficulty,
        type: input.type,
        text: input.text,
        defaultMarks: input.defaultMarks,
        negativeMarks: input.negativeMarks,
        multiScheme: input.multiScheme,
        createdById: actorId,
        options: { create: optionRows(input.options) },
      },
      include: questionInclude,
    });
    await audit(tx, actorId, "question.create", question.id, { type: question.type, topic: question.topic });
    return toQuestionDto(question);
  }, TX_OPTIONS);
}

const sameOptions = (a: { text: string; isCorrect: boolean }[], b: { text: string; isCorrect: boolean }[]) =>
  a.length === b.length && a.every((option, i) => option.text === b[i].text && option.isCorrect === b[i].isCorrect);

/**
 * Partial update. Type rules are checked on the merged question. Scoring fields
 * (type, options, marks, multi scheme) are locked once the question sits in a
 * non-draft exam or in an exam with real attempts: published papers stay stable.
 * Text, topic and difficulty can always change (attempts use snapshots anyway).
 */
export async function updateQuestion(
  id: string,
  input: z.output<typeof updateQuestionSchema>,
  actor: Actor,
): Promise<QuestionDto> {
  return prisma.$transaction(async (tx) => {
    const current = await findOwned(id, actor, tx);
    const currentOptions = current.options.map(({ text, isCorrect }) => ({ text, isCorrect }));
    const merged = questionInputSchema.parse({
      topic: input.topic ?? current.topic,
      difficulty: input.difficulty ?? current.difficulty,
      type: input.type ?? current.type,
      text: input.text ?? current.text,
      defaultMarks: input.defaultMarks ?? current.defaultMarks,
      negativeMarks: input.negativeMarks ?? current.negativeMarks,
      multiScheme: input.multiScheme ?? current.multiScheme,
      options: input.options ?? currentOptions,
    });

    const optionsChanged = input.options !== undefined && !sameOptions(merged.options, currentOptions);
    const changed = (
      ["topic", "difficulty", "type", "text", "defaultMarks", "negativeMarks", "multiScheme"] as const
    ).filter((key) => merged[key] !== current[key]) as string[];
    if (optionsChanged) changed.push("options");

    const lockedChanges = changed.filter((key) =>
      ["type", "options", "defaultMarks", "negativeMarks", "multiScheme"].includes(key),
    );
    if (lockedChanges.length > 0 && (await isLocked(tx, current))) {
      throw conflict("This question is used in a published exam; duplicate it instead", {
        lockedFields: lockedChanges,
        exams: current.examQuestions.map(({ exam }) => ({ id: exam.id, title: exam.title, status: exam.status })),
      });
    }

    if (optionsChanged) {
      await tx.option.deleteMany({ where: { questionId: id } });
      if (merged.options.length > 0) {
        await tx.option.createMany({ data: optionRows(merged.options).map((row) => ({ ...row, questionId: id })) });
      }
    }
    const updated = await tx.question.update({
      where: { id },
      data: {
        topic: merged.topic,
        difficulty: merged.difficulty,
        type: merged.type,
        text: merged.text,
        defaultMarks: merged.defaultMarks,
        negativeMarks: merged.negativeMarks,
        multiScheme: merged.multiScheme,
      },
      include: questionInclude,
    });
    if (changed.length > 0) await audit(tx, actor.userId, "question.update", id, { changed });
    return toQuestionDto(updated);
  }, TX_OPTIONS);
}

async function isLocked(
  tx: Prisma.TransactionClient,
  question: { examQuestions: { exam: { id: string; status: ExamStatus } }[] },
) {
  if (question.examQuestions.some(({ exam }) => exam.status !== ExamStatus.DRAFT)) return true;
  const examIds = question.examQuestions.map(({ exam }) => exam.id);
  if (examIds.length === 0) return false;
  const attempts = await tx.attempt.count({ where: { examId: { in: examIds }, ...REAL_ATTEMPT } });
  return attempts > 0;
}

/** Hard delete, refused (409) while any exam uses the question. */
export async function deleteQuestion(id: string, actor: Actor): Promise<void> {
  const inUse = (exams: { id: string; title: string }[]) =>
    conflict(
      `This question is used in ${exams.length} exam${exams.length === 1 ? "" : "s"}. Remove it from ${
        exams.length === 1 ? "that exam" : "those exams"
      } first, or duplicate it to make a new version.`,
      { exams },
    );

  try {
    await prisma.$transaction(async (tx) => {
      const question = await findOwned(id, actor, tx);
      if (question.examQuestions.length > 0) {
        throw inUse(question.examQuestions.map(({ exam }) => ({ id: exam.id, title: exam.title })));
      }
      await tx.question.delete({ where: { id } }); // options cascade
      await audit(tx, actor.userId, "question.delete", id, { type: question.type, topic: question.topic });
    }, TX_OPTIONS);
  } catch (error) {
    // Assigned to an exam between our check and the delete: the foreign key refuses it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      const rows = await prisma.examQuestion.findMany({
        where: { questionId: id },
        select: { exam: { select: { id: true, title: true } } },
      });
      throw inUse(rows.map(({ exam }) => exam));
    }
    throw error;
  }
}

/** Copies a visible question (with its options) into a new question owned by the caller. */
export async function duplicateQuestion(id: string, actor: Actor): Promise<QuestionDto> {
  return prisma.$transaction(async (tx) => {
    const source = await findOwned(id, actor, tx);
    const copy = await tx.question.create({
      data: {
        topic: source.topic,
        difficulty: source.difficulty,
        type: source.type,
        text: `Copy of ${source.text}`.slice(0, MAX_TEXT),
        defaultMarks: source.defaultMarks,
        negativeMarks: source.negativeMarks,
        multiScheme: source.multiScheme,
        createdById: actor.userId,
        options: {
          create: source.options.map(({ text, isCorrect, order }) => ({ text, isCorrect, order })),
        },
      },
      include: questionInclude,
    });
    await audit(tx, actor.userId, "question.duplicate", copy.id, { sourceId: source.id });
    return toQuestionDto(copy);
  }, TX_OPTIONS);
}
