import { timingSafeEqual } from "node:crypto";
import { Role } from "@prisma/client";
import { ApiError, conflict, notFound } from "@/lib/api/errors";
import { assertExamOwner } from "@/lib/auth/guards";
import { PASS_PERCENT } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { resultHash } from "@/lib/services/result-service";
import { computeExamStats, isPass, percentOf, rankByScore, scoreDistribution } from "@/lib/reports/exam-stats";
import type { AttemptReportData, ExamReportData } from "@/lib/reports/pdf";
import { maskName, scoreBand, type ScoreBand } from "@/lib/reports/privacy";
import { createRateLimiter } from "@/lib/reports/rate-limit";

type Session = { userId: string; role: Role };

/**
 * Data for one attempt's result statement (api.md 16.1). Access:
 * - CANDIDATE: own attempt only (else 404); 403 until results are published;
 * - EXAMINER (exam owner) / ADMIN: 409 until results are published; other examiners 404.
 * Sandbox attempts never have reports (404). Published but no Report row -> 409.
 * Only display fields are selected: no email, answer keys or responses reach the PDF.
 */
export async function loadAttemptReport(attemptId: string, session: Session): Promise<Omit<AttemptReportData, "verifyUrl">> {
  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: {
      userId: true,
      isSandbox: true,
      status: true,
      score: true,
      submittedAt: true,
      exam: { select: { title: true, createdById: true, resultsPublishedAt: true } },
      user: { select: { name: true, rollNo: true } },
      questions: { select: { marks: true, snapshot: true, answer: { select: { awardedMarks: true } } }, orderBy: { order: "asc" } },
      report: { select: { verifyCode: true, issuedAt: true } },
    },
  });
  if (!attempt || attempt.isSandbox) throw notFound("Report");

  if (session.role === Role.CANDIDATE) {
    if (attempt.userId !== session.userId) throw notFound("Report");
    if (!attempt.exam.resultsPublishedAt) throw new ApiError("FORBIDDEN", "Results have not been published");
  } else {
    if (session.role !== Role.ADMIN && attempt.exam.createdById !== session.userId) throw notFound("Report");
    if (!attempt.exam.resultsPublishedAt) throw conflict("Publish results first");
  }
  if (!attempt.report || attempt.status === "IN_PROGRESS" || attempt.score === null) {
    throw conflict("No verifiable report has been issued for this attempt");
  }

  const topics = new Map<string, { topic: string; awarded: number; available: number }>();
  for (const q of attempt.questions) {
    const topic = topicOf(q.snapshot);
    const row = topics.get(topic) ?? { topic, awarded: 0, available: 0 };
    row.awarded += q.answer?.awardedMarks ?? 0;
    row.available += q.marks;
    topics.set(topic, row);
  }
  const totalMarks = attempt.questions.reduce((sum, q) => sum + q.marks, 0);

  return {
    examTitle: attempt.exam.title,
    candidate: { name: attempt.user.name, rollNo: attempt.user.rollNo },
    score: attempt.score,
    totalMarks,
    percentage: percentOf(attempt.score, totalMarks),
    passed: isPass(attempt.score, totalMarks),
    passPercent: PASS_PERCENT,
    topics: [...topics.values()],
    submittedAt: attempt.submittedAt,
    issuedAt: attempt.report.issuedAt,
    verifyCode: attempt.report.verifyCode,
  };
}

function topicOf(snapshot: unknown) {
  const topic = (snapshot as { topic?: unknown } | null)?.topic;
  return typeof topic === "string" && topic.trim() ? topic.trim() : "General";
}

/**
 * Data for the exam summary PDF (api.md 16.2). Exam owner or admin. Statistics and ranking
 * use real (non-sandbox) GRADED attempts; submitted-but-ungraded ones are only counted.
 */
export async function loadExamReport(examId: string, session: Session): Promise<ExamReportData> {
  const exam = await assertExamOwner(examId, session.userId, session.role);
  const attempts = await prisma.attempt.findMany({
    where: { examId, isSandbox: false, status: { in: ["SUBMITTED", "GRADED"] } },
    select: {
      status: true,
      score: true,
      user: { select: { name: true, rollNo: true } },
      questions: { select: { marks: true } },
    },
  });

  const graded = attempts
    .filter((a) => a.status === "GRADED" && a.score !== null)
    .map((a) => ({
      name: a.user.name,
      rollNo: a.user.rollNo,
      score: a.score as number,
      total: a.questions.reduce((sum, q) => sum + q.marks, 0),
    }));

  return {
    exam: {
      title: exam.title,
      startAt: exam.startAt,
      endAt: exam.endAt,
      durationMin: exam.durationMin,
      totalMarks: exam.totalMarks,
      resultsPublishedAt: exam.resultsPublishedAt,
    },
    stats: computeExamStats(graded),
    distribution: scoreDistribution(graded.map((a) => percentOf(a.score, a.total))),
    passPercent: PASS_PERCENT,
    ranking: rankByScore(graded).map((a) => ({
      ...a,
      percentage: percentOf(a.score, a.total),
      passed: isPass(a.score, a.total),
    })),
    awaitingGrading: attempts.length - graded.length,
    generatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------------------
// Public verification (api.md 16.3)
// ---------------------------------------------------------------------------------------

export type VerifyResult =
  | { valid: true; examTitle: string; issuedAt: string; candidate: string; scoreBand: ScoreBand }
  | { valid: false };

/** 30 lookups per minute per IP. Exported so tests can shrink the limit and reset it. */
export const VERIFY_MAX_PER_MIN = 30;
export const verifyRateLimiter = createRateLimiter({ limit: VERIFY_MAX_PER_MIN, windowMs: 60_000 });

/** Codes are 32 hex chars today (M1's publishResults); accept a little more, reject junk early. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Looks up a report and recomputes its hash with Member 1's `resultHash` from the current
 * attempt data. Every failure (unknown code, sandbox, missing score, tampered data) gives
 * the same `{ valid: false }`, so callers cannot tell which check failed.
 */
export async function verifyReport(code: string): Promise<VerifyResult> {
  const invalid = { valid: false } as const;
  if (!CODE_PATTERN.test(code)) return invalid;
  const report = await prisma.report.findUnique({
    where: { verifyCode: code },
    select: {
      hash: true,
      issuedAt: true,
      attempt: {
        select: {
          id: true,
          examId: true,
          score: true,
          isSandbox: true,
          user: { select: { name: true } },
          exam: { select: { title: true } },
          questions: { select: { marks: true } },
        },
      },
    },
  });
  const attempt = report?.attempt;
  if (!report || !attempt || attempt.isSandbox || attempt.score === null) return invalid;

  const expected = Buffer.from(resultHash(attempt.id, attempt.examId, attempt.score, report.issuedAt));
  const stored = Buffer.from(report.hash);
  if (expected.length !== stored.length || !timingSafeEqual(expected, stored)) return invalid;

  const total = attempt.questions.reduce((sum, q) => sum + q.marks, 0);
  return {
    valid: true,
    examTitle: attempt.exam.title,
    issuedAt: report.issuedAt.toISOString(),
    candidate: maskName(attempt.user.name),
    scoreBand: scoreBand(attempt.score, total),
  };
}
