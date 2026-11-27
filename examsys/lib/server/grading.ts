import { AttemptStatus, Prisma, Role } from "@prisma/client";
import { ApiError, conflict, notFound } from "@/lib/api/errors";
import { assertExamOwner } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { finalizeIfExpired } from "@/lib/services/attempt-service";
import { recomputeAttemptScore } from "@/lib/services/result-service";
import type {
  AttemptStatusName,
  GradeData,
  GradeResponse,
  QueueQuery,
  QueueResponse,
  ReviewAnswer,
  ReviewResponse,
  SubmissionItem,
  SubmissionsResponse,
} from "@/lib/validation/grading";

/**
 * Evaluation & grading (Member 2, PR 7). Objective answers are graded by Member 1's
 * `finalizeAttempt` (which also auto-grades unanswered WRITTEN questions with 0); this
 * module lists submissions, shows the examiner review (with keys) and grades WRITTEN
 * answers, re-scoring the attempt with Member 1's `recomputeAttemptScore` after each grade.
 */

type Session = { userId: string; role: Role };

/** Shape of `AttemptQuestion.snapshot` written by Member 1's `startOrResumeAttempt`. */
type Snapshot = {
  type: "MCQ" | "MULTI" | "WRITTEN";
  text: string;
  topic: string;
  difficulty: string;
  negativeMarks: number;
  multiScheme: "ALL_OR_NOTHING" | "PARTIAL";
  options: { id: string; text: string; isCorrect: boolean }[];
};

const FINALIZED: AttemptStatus[] = [AttemptStatus.SUBMITTED, AttemptStatus.GRADED];
const candidateSelect = { id: true, name: true, email: true, rollNo: true } satisfies Prisma.UserSelect;
const writtenOnly = { snapshot: { path: ["type"], equals: "WRITTEN" } } satisfies Prisma.AttemptQuestionWhereInput;

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Lazily finalizes the exam's real attempts that are past their time + grace window. */
async function finalizeExpiredAttempts(examId: string) {
  const open = await prisma.attempt.findMany({
    where: { examId, isSandbox: false, status: AttemptStatus.IN_PROGRESS },
    select: { id: true },
  });
  await Promise.all(open.map((attempt) => finalizeIfExpired(attempt.id)));
}

// ---- GET /api/exams/:id/submissions ------------------------------------------------------

export async function listSubmissions(examId: string, session: Session): Promise<SubmissionsResponse> {
  const exam = await assertExamOwner(examId, session.userId, session.role);
  await finalizeExpiredAttempts(examId);

  const attempts = await prisma.attempt.findMany({
    where: { examId, isSandbox: false },
    select: {
      id: true,
      status: true,
      startedAt: true,
      submittedAt: true,
      score: true,
      lateSyncCount: true,
      user: { select: candidateSelect },
      questions: { select: { marks: true, answer: { select: { awardedMarks: true } } } },
      _count: { select: { incidents: true } },
    },
    orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
  });

  const summary = { total: 0, inProgress: 0, submitted: 0, graded: 0, pendingWritten: 0 };
  const items: SubmissionItem[] = attempts.map((attempt) => {
    const finalized = attempt.status !== AttemptStatus.IN_PROGRESS;
    // After finalize every objective answer (and every empty written one) has marks,
    // so the only null marks left are written answers waiting for the examiner.
    const pendingWritten = finalized ? attempt.questions.filter((q) => q.answer?.awardedMarks == null).length : 0;
    summary.total += 1;
    summary.pendingWritten += pendingWritten;
    if (attempt.status === AttemptStatus.IN_PROGRESS) summary.inProgress += 1;
    else if (attempt.status === AttemptStatus.SUBMITTED) summary.submitted += 1;
    else summary.graded += 1;
    return {
      attemptId: attempt.id,
      candidate: attempt.user,
      status: attempt.status,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: iso(attempt.submittedAt),
      score: finalized ? attempt.score : null,
      totalMarks: attempt.questions.reduce((sum, q) => sum + q.marks, 0),
      pendingWritten,
      lateSyncCount: attempt.lateSyncCount,
      incidentCount: attempt._count.incidents,
    };
  });

  return {
    exam: { id: exam.id, title: exam.title, resultsPublishedAt: iso(exam.resultsPublishedAt) },
    items,
    summary,
  };
}

// ---- GET /api/attempts/:id/review ---------------------------------------------------------

export async function getAttemptReview(attemptId: string, session: Session): Promise<ReviewResponse> {
  const head = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: { id: true, isSandbox: true, exam: { select: { createdById: true } } },
  });
  // Admins see every real attempt; sandbox previews belong to the exam's examiner only.
  const owner = head?.exam.createdById === session.userId;
  if (!head || !(owner || (session.role === Role.ADMIN && !head.isSandbox))) throw notFound("Attempt");

  await finalizeIfExpired(attemptId);
  const attempt = await prisma.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      exam: { select: { id: true, title: true, resultsPublishedAt: true } },
      user: { select: candidateSelect },
      questions: { include: { answer: true }, orderBy: { order: "asc" } },
      incidents: { orderBy: { at: "asc" }, select: { type: true, at: true, meta: true } },
    },
  });

  return {
    exam: { id: attempt.exam.id, title: attempt.exam.title, resultsPublishedAt: iso(attempt.exam.resultsPublishedAt) },
    attempt: {
      id: attempt.id,
      status: attempt.status,
      isSandbox: attempt.isSandbox,
      score: attempt.status === AttemptStatus.IN_PROGRESS ? null : attempt.score,
      totalMarks: attempt.questions.reduce((sum, q) => sum + q.marks, 0),
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: iso(attempt.submittedAt),
      lateSyncCount: attempt.lateSyncCount,
      candidate: attempt.user,
    },
    questions: attempt.questions.map((q) => {
      const snapshot = q.snapshot as Snapshot;
      const answer: ReviewAnswer | null = q.answer
        ? {
            id: q.answer.id,
            response: (q.answer.response ?? null) as ReviewAnswer["response"],
            flagged: q.answer.flagged,
            awardedMarks: q.answer.awardedMarks,
            feedback: q.answer.feedback,
            gradedAt: iso(q.answer.gradedAt),
          }
        : null;
      return {
        attemptQuestionId: q.id,
        questionId: q.questionId,
        order: q.order,
        type: snapshot.type,
        topic: snapshot.topic,
        text: snapshot.text,
        marks: q.marks,
        negativeMarks: snapshot.negativeMarks ?? 0,
        multiScheme: snapshot.multiScheme ?? "ALL_OR_NOTHING",
        options: snapshot.type === "WRITTEN" ? [] : snapshot.options.map(({ id, text, isCorrect }) => ({ id, text, isCorrect })),
        answer,
      };
    }),
    incidents: attempt.incidents.map((incident) => ({ type: incident.type, at: incident.at.toISOString(), meta: incident.meta })),
  };
}

// ---- GET /api/exams/:id/grading/queue -----------------------------------------------------

export async function gradingQueue(examId: string, query: QueueQuery, session: Session): Promise<QueueResponse> {
  const exam = await assertExamOwner(examId, session.userId, session.role);
  await finalizeExpiredAttempts(examId);

  const finalizedAttempt = { examId, isSandbox: false, status: { in: FINALIZED } } satisfies Prisma.AttemptWhereInput;
  const writtenOfFinalized = {
    attemptQuestion: { ...writtenOnly, attempt: finalizedAttempt },
  } satisfies Prisma.AnswerWhereInput;
  const ungraded = { ...writtenOfFinalized, awardedMarks: null } satisfies Prisma.AnswerWhereInput;
  const where: Prisma.AnswerWhereInput = {
    awardedMarks: null,
    attemptQuestion: {
      ...writtenOnly,
      ...(query.questionId ? { questionId: query.questionId } : {}),
      attempt: { ...finalizedAttempt, ...(query.candidateId ? { userId: query.candidateId } : {}) },
    },
  };

  const [rows, total, progressTotal, progressPending, writtenQuestions, finalizedAttempts] = await Promise.all([
    prisma.answer.findMany({
      where,
      select: {
        id: true,
        response: true,
        feedback: true,
        attemptQuestion: {
          select: {
            id: true,
            questionId: true,
            order: true,
            marks: true,
            snapshot: true,
            attempt: { select: { id: true, submittedAt: true, user: { select: candidateSelect } } },
          },
        },
      },
      orderBy: [
        { attemptQuestion: { order: "asc" } },
        { attemptQuestion: { attempt: { submittedAt: "asc" } } },
        { id: "asc" },
      ],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.answer.count({ where }),
    prisma.answer.count({ where: writtenOfFinalized }),
    prisma.answer.count({ where: ungraded }),
    prisma.examQuestion.findMany({
      where: { examId, question: { type: "WRITTEN" } },
      select: { questionId: true, order: true, question: { select: { text: true } } },
      orderBy: { order: "asc" },
    }),
    prisma.attempt.findMany({
      where: finalizedAttempt,
      select: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  return {
    items: rows.map((row) => {
      const q = row.attemptQuestion;
      const snapshot = q.snapshot as Snapshot;
      const response = row.response as { text?: unknown } | null;
      return {
        answerId: row.id,
        attemptId: q.attempt.id,
        candidate: q.attempt.user,
        question: {
          attemptQuestionId: q.id,
          questionId: q.questionId,
          order: q.order,
          text: snapshot.text,
          topic: snapshot.topic,
          marks: q.marks,
        },
        response: { text: typeof response?.text === "string" ? response.text : "" },
        feedback: row.feedback,
        submittedAt: iso(q.attempt.submittedAt),
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total,
    progress: { graded: progressTotal - progressPending, total: progressTotal },
    filters: {
      questions: writtenQuestions.map((q) => ({ questionId: q.questionId, order: q.order, text: q.question.text })),
      candidates: finalizedAttempts.map((attempt) => attempt.user),
    },
    resultsPublishedAt: iso(exam.resultsPublishedAt),
  };
}

// ---- PATCH /api/answers/:id/grade ---------------------------------------------------------

/**
 * Member 1's `recomputeAttemptScore` runs as a SERIALIZABLE transaction, so grading two answers
 * at the same moment can fail one with a serialization error (P2034). The grade itself is already
 * saved by then, so retry the re-score rather than leave a stale score / status behind.
 */
async function rescore(attemptId: string) {
  for (let round = 1; ; round++) {
    try {
      return await recomputeAttemptScore(attemptId);
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || round >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * round + Math.random() * 100));
    }
  }
}

export async function gradeAnswer(answerId: string, input: GradeData, session: Session): Promise<GradeResponse> {
  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    select: {
      id: true,
      awardedMarks: true,
      feedback: true,
      attemptQuestion: {
        select: {
          marks: true,
          snapshot: true,
          attempt: {
            select: {
              id: true,
              status: true,
              isSandbox: true,
              exam: { select: { createdById: true, resultsPublishedAt: true } },
            },
          },
        },
      },
    },
  });
  const attempt = answer?.attemptQuestion.attempt;
  if (!answer || !attempt || (session.role !== Role.ADMIN && attempt.exam.createdById !== session.userId)) {
    throw notFound("Answer");
  }
  const { marks } = answer.attemptQuestion;
  if (attempt.isSandbox) throw conflict("Sandbox attempts are not graded");
  if ((answer.attemptQuestion.snapshot as Snapshot).type !== "WRITTEN") {
    throw conflict("Only written answers are graded by hand; objective answers are graded automatically");
  }
  if (attempt.status === AttemptStatus.IN_PROGRESS) throw conflict("This attempt is still in progress");
  if (attempt.exam.resultsPublishedAt) throw conflict("Results are already published; grades are locked");
  if (input.awardedMarks > marks) {
    throw new ApiError("VALIDATION_ERROR", "Some fields are invalid", { awardedMarks: `Marks cannot be more than ${marks}` });
  }

  const gradedAt = new Date();
  // Re-check the state in the write itself, so a publish or a reopened attempt in between can't slip through.
  const updated = await prisma.answer.updateMany({
    where: {
      id: answerId,
      attemptQuestion: { attempt: { status: { in: FINALIZED }, exam: { resultsPublishedAt: null } } },
    },
    data: {
      awardedMarks: input.awardedMarks,
      ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
      gradedAt,
      gradedById: session.userId,
    },
  });
  if (!updated.count) throw conflict("This answer can no longer be graded");

  const [rescored] = await Promise.all([
    rescore(attempt.id),
    prisma.auditLog.create({
      data: {
        actorId: session.userId,
        action: "grade.update",
        entity: "Answer",
        entityId: answerId,
        meta: { attemptId: attempt.id, previous: answer.awardedMarks, awardedMarks: input.awardedMarks, maxMarks: marks },
      },
    }),
  ]);
  const feedback = input.feedback === undefined ? answer.feedback : input.feedback;

  return {
    answer: { id: answerId, awardedMarks: input.awardedMarks, feedback, gradedAt: gradedAt.toISOString() },
    attempt: { id: rescored.id, status: rescored.status as AttemptStatusName, score: rescored.score },
  };
}
