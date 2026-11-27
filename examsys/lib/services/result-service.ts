import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { PASS_PERCENT } from "@/lib/constants";
import { finalizeIfExpired } from "@/lib/services/attempt-service";

export function resultHash(attemptId: string, examId: string, score: number, issuedAt: Date) {
  return createHash("sha256").update(`${attemptId}|${examId}|${score}|${issuedAt.toISOString()}`).digest("hex");
}

export async function recomputeAttemptScore(attemptId: string) {
  return prisma.$transaction(async tx => {
    const attempt = await tx.attempt.findUnique({ where: { id: attemptId }, include: { questions: { include: { answer: true } } } });
    if (!attempt) throw new AppError("NOT_FOUND", 404, "Attempt not found");
    if (attempt.status === "IN_PROGRESS") throw new AppError("CONFLICT", 409, "Attempt is still in progress");
    const pending = attempt.questions.some(q => q.answer?.awardedMarks === null || q.answer?.awardedMarks === undefined);
    const score = Math.max(0, attempt.questions.reduce((sum, q) => sum + (q.answer?.awardedMarks ?? 0), 0));
    const updated = await tx.attempt.updateMany({
      where: { id: attemptId, status: { in: ["SUBMITTED", "GRADED"] } },
      data: { score, status: pending ? "SUBMITTED" : "GRADED" },
    });
    if (!updated.count) throw new AppError("CONFLICT", 409, "Attempt is still in progress");
    return tx.attempt.findUniqueOrThrow({ where: { id: attemptId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function publishResults(examId: string, actorId: string) {
  const attempts = await prisma.attempt.findMany({ where: { examId, isSandbox: false }, select: { id: true, status: true } });
  await Promise.all(attempts.filter(a => a.status === "IN_PROGRESS").map(a => finalizeIfExpired(a.id)));
  return prisma.$transaction(async tx => {
    const exam = await tx.exam.findUniqueOrThrow({ where: { id: examId } });
    if (exam.resultsPublishedAt) return { publishedAt: exam.resultsPublishedAt, reportsIssued: 0, alreadyPublished: true };
    const current = await tx.attempt.findMany({ where: { examId, isSandbox: false }, include: { user: { select: { id: true, name: true } }, questions: { include: { answer: true } }, report: true } });
    const blockers = current.flatMap(a => {
      if (a.status === "IN_PROGRESS") return [{ type: "IN_PROGRESS", attemptId: a.id, candidate: a.user }];
      const count = a.questions.filter(q => q.answer?.awardedMarks === null || q.answer?.awardedMarks === undefined).length;
      return count ? [{ type: "UNGRADED_WRITTEN", attemptId: a.id, candidate: a.user, count }] : [];
    });
    if (blockers.length) throw new AppError("CONFLICT", 409, "Results cannot be published yet", undefined, { blockers });
    const publishedAt = new Date();
    await tx.exam.update({ where: { id: examId }, data: { resultsPublishedAt: publishedAt } });
    let reportsIssued = 0;
    for (const a of current) if (!a.report && a.status === "GRADED" && a.score !== null) {
      const issuedAt = new Date();
      await tx.report.create({ data: { attemptId: a.id, verifyCode: randomBytes(16).toString("hex"), issuedAt, hash: resultHash(a.id, examId, a.score, issuedAt) } });
      reportsIssued++;
    }
    await tx.auditLog.create({ data: { action: "results.publish", entity: "Exam", entityId: examId, actorId, meta: { reportsIssued } } });
    return { publishedAt, reportsIssued, alreadyPublished: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function candidateResult(attemptId: string, userId: string) {
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId }, include: { exam: true, questions: { include: { answer: true }, orderBy: { order: "asc" } }, report: true } });
  if (!attempt || attempt.userId !== userId || attempt.isSandbox) throw new AppError("NOT_FOUND", 404, "Result not found");
  if (!attempt.exam.resultsPublishedAt) throw new AppError("FORBIDDEN", 403, "Results have not been published");
  const totalMarks = attempt.questions.reduce((sum, q) => sum + q.marks, 0);
  const percentage = totalMarks ? (attempt.score ?? 0) / totalMarks * 100 : 0;
  const byTopic = new Map<string, { topic: string; awarded: number; total: number }>();
  const questions = attempt.questions.map(q => {
    const s = q.snapshot as { type: string; topic: string; text: string };
    const topic = byTopic.get(s.topic) ?? { topic: s.topic, awarded: 0, total: 0 };
    topic.awarded += q.answer?.awardedMarks ?? 0; topic.total += q.marks; byTopic.set(s.topic, topic);
    const value = q.answer?.response as { text?: string; optionIds?: string[] } | null;
    const hasAnswer = !!value && (typeof value.text === "string" ? !!value.text.trim() : !!value.optionIds?.length);
    const marks = q.answer?.awardedMarks ?? 0;
    return { order: q.order, type: s.type, topic: s.topic, text: s.text, marks: q.marks, awardedMarks: marks, outcome: !hasAnswer ? "UNANSWERED" : marks >= q.marks ? "CORRECT" : marks > 0 ? "PARTIAL" : "INCORRECT" };
  });
  return { exam: { title: attempt.exam.title }, attempt: { id: attempt.id, submittedAt: attempt.submittedAt, score: attempt.score, totalMarks, percentage, passed: percentage >= PASS_PERCENT }, questions, topicBreakdown: [...byTopic.values()], report: attempt.report ? { verifyCode: attempt.report.verifyCode, pdfUrl: `/api/reports/${attemptId}/pdf` } : null };
}
