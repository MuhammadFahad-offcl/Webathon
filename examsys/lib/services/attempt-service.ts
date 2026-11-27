import { AttemptStatus, ExamStatus, IncidentType, Prisma, Role } from "@prisma/client";
import { randomInt } from "node:crypto";
import { prisma } from "../prisma";
import { AppError } from "../errors";
import { DISCONNECT_GAP_MS, GRACE_MS, INCIDENT_MAX_PER_MIN, WRITTEN_MAX_CHARS } from "../constants";

type Snapshot = { type: "MCQ" | "MULTI" | "WRITTEN"; text: string; topic: string; difficulty: string; negativeMarks: number; multiScheme: string; options: { id: string; text: string; isCorrect: boolean }[] };
export type SaveItem = { questionId: string; response: unknown; flagged: boolean; seq: number; elapsedMs: number };
export function isAnswerWithinSyncWindow(elapsedMs: number, startedAt: Date, expiresAt: Date, now: Date) {
  if (now <= expiresAt) return true;
  return now.getTime() <= expiresAt.getTime() + GRACE_MS && elapsedMs <= expiresAt.getTime() - startedAt.getTime();
}
const shuffle = <T,>(items: T[]) => { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; } return result; };
const answered = (value: unknown) => !!value && typeof value === "object" && ("text" in value ? typeof value.text === "string" && value.text.trim().length > 0 : "optionIds" in value && Array.isArray(value.optionIds) && value.optionIds.length > 0);
export function gradeObjective(s: Snapshot, value: unknown, marks: number) { if (!answered(value)) return 0; const ids = (value as { optionIds: string[] }).optionIds; const correct = s.options.filter(o => o.isCorrect).map(o => o.id); if (s.type === "MCQ") return correct.includes(ids[0]) ? marks : s.negativeMarks > 0 ? -s.negativeMarks : 0; if (s.multiScheme === "ALL_OR_NOTHING") return ids.length === correct.length && ids.every(id => correct.includes(id)) ? marks : 0; return marks * Math.max(0, (ids.filter(id => correct.includes(id)).length - ids.filter(id => !correct.includes(id)).length) / correct.length); }
function valid(s: Snapshot, value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const v = value as Record<string, unknown>; if (s.type === "WRITTEN") return Object.keys(v).length === 1 && typeof v.text === "string" && v.text.length <= WRITTEN_MAX_CHARS; if (Object.keys(v).length !== 1 || !Array.isArray(v.optionIds) || v.optionIds.some(id => typeof id !== "string" || !s.options.some(o => o.id === id))) return false; return new Set(v.optionIds).size === v.optionIds.length && (s.type !== "MCQ" || v.optionIds.length <= 1); }

export async function assertAttempt(id: string, userId: string) { const attempt = await prisma.attempt.findUnique({ where: { id }, include: { exam: true } }); if (!attempt || attempt.userId !== userId) throw new AppError("NOT_FOUND", 404, "Attempt not found"); return attempt; }

export async function startOrResumeAttempt(examId: string, userId: string, role: Role, sandbox = false) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { questions: { include: { question: { include: { options: { orderBy: { order: "asc" } } } } }, orderBy: { order: "asc" } } } });
  if (!exam) throw new AppError("NOT_FOUND", 404, "Exam not found");
  if (sandbox ? role !== Role.EXAMINER || exam.createdById !== userId : role !== Role.CANDIDATE) throw new AppError("FORBIDDEN", 403, "Access denied");
  const now = new Date();
  if (!sandbox) {
    if (!await prisma.enrollment.findUnique({ where: { examId_userId: { examId, userId } } })) throw new AppError("NOT_ENROLLED", 403, "Not enrolled");
    const existing = await prisma.attempt.findUnique({ where: { examId_userId_sandboxRun: { examId, userId, sandboxRun: 0 } } });
    if (existing) { await finalizeIfExpired(existing.id); const latest = await prisma.attempt.findUniqueOrThrow({ where: { id: existing.id } }); if (latest.status === "IN_PROGRESS") return { attemptId: latest.id, resumed: true }; throw new AppError("CONFLICT", 409, "Exam already completed"); }
    if (exam.status !== ExamStatus.PUBLISHED || now < exam.startAt) throw new AppError("EXAM_NOT_AVAILABLE", 403, "Exam not available");
    if (now > exam.endAt || exam.resultsPublishedAt) throw new AppError("EXAM_ENDED", 403, "Exam ended");
  }
  if (!exam.questions.length) throw new AppError("CONFLICT", 409, "Exam has no questions");
  const questions = exam.shuffleQuestions ? shuffle(exam.questions) : exam.questions;
  const expiresAt = new Date(sandbox ? now.getTime() + exam.durationMin * 60000 : Math.min(now.getTime() + exam.durationMin * 60000, exam.endAt.getTime()));
  for (let retry = 0; retry < 5; retry++) {
    const sandboxRun = sandbox ? ((await prisma.attempt.aggregate({ where: { examId, userId }, _max: { sandboxRun: true } }))._max.sandboxRun ?? 0) + 1 : 0;
    try { const attempt = await prisma.attempt.create({ data: { examId, userId, startedAt: now, expiresAt, isSandbox: sandbox, sandboxRun, questions: { create: questions.map((item, index) => ({ questionId: item.questionId, order: index + 1, marks: item.marks, snapshot: { type: item.question.type, text: item.question.text, topic: item.question.topic, difficulty: item.question.difficulty, negativeMarks: item.question.negativeMarks, multiScheme: item.question.multiScheme, options: (exam.shuffleOptions ? shuffle(item.question.options) : item.question.options).map(o => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })) } })) } } }); return { attemptId: attempt.id, resumed: false }; }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error; if (!sandbox) { const existing = await prisma.attempt.findUnique({ where: { examId_userId_sandboxRun: { examId, userId, sandboxRun: 0 } } }); if (existing?.status === "IN_PROGRESS") return { attemptId: existing.id, resumed: true }; throw new AppError("CONFLICT", 409, "Exam already completed"); } }
  }
  throw new AppError("CONFLICT", 409, "Retry sandbox start");
}

export async function finalizeAttempt(id: string) {
  return prisma.$transaction(async tx => {
    const changed = await tx.attempt.updateMany({ where: { id, status: AttemptStatus.IN_PROGRESS }, data: { status: AttemptStatus.SUBMITTED, submittedAt: new Date() } });
    if (!changed.count) return tx.attempt.findUniqueOrThrow({ where: { id } });
    const attempt = await tx.attempt.findUniqueOrThrow({ where: { id }, include: { questions: { include: { answer: true } } } });
    let total = 0; let pending = false;
    for (const q of attempt.questions) { const s = q.snapshot as Snapshot; const marks = s.type === "WRITTEN" ? answered(q.answer?.response) ? null : 0 : gradeObjective(s, q.answer?.response, q.marks); if (marks === null) pending = true; else total += marks; await tx.answer.upsert({ where: { attemptQuestionId: q.id }, create: { attemptQuestionId: q.id, response: Prisma.JsonNull, awardedMarks: marks }, update: { awardedMarks: marks } }); }
    return tx.attempt.update({ where: { id }, data: { score: Math.max(0, total), status: pending ? AttemptStatus.SUBMITTED : AttemptStatus.GRADED } });
  });
}
export async function finalizeIfExpired(id: string) { const attempt = await prisma.attempt.findUnique({ where: { id } }); if (attempt?.status === "IN_PROGRESS" && Date.now() > attempt.expiresAt.getTime() + GRACE_MS) return finalizeAttempt(id); return attempt; }

export async function loadAttempt(id: string, userId: string) {
  await assertAttempt(id, userId); await finalizeIfExpired(id);
  const a = await prisma.attempt.findUniqueOrThrow({ where: { id }, include: { exam: { include: { announcements: { orderBy: { at: "asc" } } } }, questions: { include: { answer: true }, orderBy: { order: "asc" } } } });
  const now = new Date();
  return { serverNow: now.toISOString(), attempt: { id, status: a.status, startedAt: a.startedAt, expiresAt: a.expiresAt, remainingMs: Math.max(0, a.expiresAt.getTime() - now.getTime()), inGrace: a.status === "IN_PROGRESS" && now > a.expiresAt && now.getTime() <= a.expiresAt.getTime() + GRACE_MS }, exam: { title: a.exam.title, instructions: a.exam.instructions, durationMin: a.exam.durationMin, totalMarks: a.questions.reduce((sum, q) => sum + q.marks, 0) }, questions: a.questions.map(q => { const s = q.snapshot as Snapshot; return { id: q.id, order: q.order, type: s.type, text: s.text, marks: q.marks, options: s.options.map(o => ({ id: o.id, text: o.text })) }; }), answers: Object.fromEntries(a.questions.filter(q => q.answer).map(q => [q.id, { response: q.answer!.response, flagged: q.answer!.flagged, seq: q.answer!.seq }])), announcements: a.exam.announcements.map(x => ({ id: x.id, message: x.message, at: x.at })) };
}

export async function saveAnswers(id: string, userId: string, items: SaveItem[]) {
  const a = await assertAttempt(id, userId); await finalizeIfExpired(id);
  const qs = await prisma.attemptQuestion.findMany({ where: { attemptId: id } }); const byId = new Map(qs.map(q => [q.id, q]));
  const results: { questionId: string; status: string }[] = [];
  for (const item of items) {
    const now = new Date(); const q = byId.get(item.questionId);
    let status = "rejected_invalid";
    if (a.status !== "IN_PROGRESS" || !isAnswerWithinSyncWindow(item.elapsedMs, a.startedAt, a.expiresAt, now)) status = "rejected_late";
    else if (q && valid(q.snapshot as Snapshot, item.response)) {
      const updated = await prisma.answer.updateMany({ where: { attemptQuestionId: q.id, seq: { lt: item.seq }, attemptQuestion: { attempt: { status: "IN_PROGRESS" } } }, data: { response: item.response as Prisma.InputJsonValue, flagged: item.flagged, seq: item.seq, savedAt: now } });
      if (updated.count) status = "saved";
      else { const existing = await prisma.answer.findUnique({ where: { attemptQuestionId: q.id } }); if (existing) status = "ignored_stale"; else if ((await prisma.attempt.findUniqueOrThrow({ where: { id } })).status !== "IN_PROGRESS") status = "rejected_late"; else try { await prisma.answer.create({ data: { attemptQuestionId: q.id, response: item.response as Prisma.InputJsonValue, flagged: item.flagged, seq: item.seq } }); status = "saved"; } catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error; const retried = await prisma.answer.updateMany({ where: { attemptQuestionId: q.id, seq: { lt: item.seq }, attemptQuestion: { attempt: { status: "IN_PROGRESS" } } }, data: { response: item.response as Prisma.InputJsonValue, flagged: item.flagged, seq: item.seq, savedAt: now } }); status = retried.count ? "saved" : "ignored_stale"; } }
      if (now > a.expiresAt && status === "saved") { await prisma.attempt.update({ where: { id }, data: { lateSyncCount: { increment: 1 } } }); await prisma.incident.create({ data: { attemptId: id, type: "LATE_SYNC", meta: { questionId: item.questionId } } }); }
    }
    results.push({ questionId: item.questionId, status });
  }
  return { serverNow: new Date().toISOString(), expiresAt: a.expiresAt.toISOString(), results };
}

export async function heartbeat(id: string, userId: string, since?: Date) {
  const a = await assertAttempt(id, userId); await finalizeIfExpired(id);
  if ((await prisma.attempt.findUniqueOrThrow({ where: { id } })).status !== "IN_PROGRESS") throw new AppError("ATTEMPT_CLOSED", 409, "Attempt closed");
  const now = new Date();
  if (a.lastHeartbeatAt && now.getTime() - a.lastHeartbeatAt.getTime() > DISCONNECT_GAP_MS && !a.isSandbox) await prisma.incident.createMany({ data: [{ attemptId: id, type: "DISCONNECT", at: new Date(a.lastHeartbeatAt.getTime() + DISCONNECT_GAP_MS) }, { attemptId: id, type: "RECONNECT", at: now }] });
  await prisma.attempt.update({ where: { id }, data: { lastHeartbeatAt: now } });
  const announcements = await prisma.announcement.findMany({ where: { examId: a.examId, ...(since ? { at: { gt: since } } : {}) }, orderBy: { at: "asc" }, select: { id: true, message: true, at: true } });
  return { serverNow: now.toISOString(), expiresAt: a.expiresAt.toISOString(), announcements };
}

export async function recordIncident(id: string, userId: string, type: IncidentType, meta?: Prisma.InputJsonValue) {
  const a = await assertAttempt(id, userId); await finalizeIfExpired(id);
  if (a.status !== "IN_PROGRESS" || (await prisma.attempt.findUniqueOrThrow({ where: { id } })).status !== "IN_PROGRESS") throw new AppError("ATTEMPT_CLOSED", 409, "Attempt closed");
  if (a.isSandbox) throw new AppError("FORBIDDEN", 403, "Sandbox incidents disabled");
  if ((await prisma.incident.count({ where: { attemptId: id, at: { gt: new Date(Date.now() - 60000) } } })) >= INCIDENT_MAX_PER_MIN) throw new AppError("RATE_LIMITED", 429, "Too many incidents");
  return prisma.incident.create({ data: { attemptId: id, type, ...(meta === undefined ? {} : { meta }) }, select: { id: true } });
}
