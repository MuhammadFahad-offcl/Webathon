import { Role, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as submissions } from "@/app/api/exams/[id]/submissions/route";
import { GET as review } from "@/app/api/attempts/[id]/review/route";
import { GET as queue } from "@/app/api/exams/[id]/grading/queue/route";
import { PATCH as grade } from "@/app/api/answers/[id]/grade/route";
import { POST as startAttempt } from "@/app/api/exams/[id]/attempts/route"; // Member 1
import { PUT as saveAnswers } from "@/app/api/attempts/[id]/answers/route"; // Member 1
import { POST as submitAttempt } from "@/app/api/attempts/[id]/submit/route"; // Member 1
import { POST as publishResults } from "@/app/api/exams/[id]/results/publish/route"; // Member 1
import { GRACE_MS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { actAs, call, cleanupTestData, makeExam, makeQuestion, makeUser } from "./helpers";

// Member 1's finalize (submit, lazy finalize, publish) runs in an interactive transaction with
// Prisma's default 5 s timeout. At ~1 s per round trip to the remote test database it needs
// longer, so this file installs a client with a longer timeout before `lib/prisma` loads
// (lib/prisma reuses `globalThis.prisma`). Production latency is unaffected.
await vi.hoisted(async () => {
  const { PrismaClient } = await import("@prisma/client");
  (globalThis as { prisma?: unknown }).prisma = new PrismaClient({
    log: ["error"],
    transactionOptions: { timeout: 60_000, maxWait: 30_000 },
  });
});

/**
 * Evaluation & grading (PR 7) on realistic data built through Member 1's attempt engine:
 * candidates start, autosave MCQ + WRITTEN answers and submit; then the examiner reviews,
 * grades the written answers and publishes results through Member 1's endpoint.
 *
 * Exam: Q1 MCQ (2 marks), Q2 WRITTEN (5), Q3 WRITTEN (3).
 *   alice: Q1 correct, Q2 + Q3 written, submitted          -> 2 pending written
 *   bob:   Q1 wrong,   Q2 written, Q3 empty, submitted      -> Q3 auto-graded 0, 1 pending
 *   carol: Q2 written, still in progress (expired later)    -> lazily finalized, 1 pending
 *   + the examiner's sandbox preview (must never be listed or graded)
 */

let examiner: User, other: User, admin: User, alice: User, bob: User, carol: User;
let examId: string;
let mcqId: string, w1Id: string, w2Id: string;
const attempts: Record<string, string> = {};
/** answerId by `${candidateName}:${bankQuestionId}` */
const answers: Record<string, string> = {};

/**
 * `call` signs the cookie for the current `actAs` user before its first await, so
 * switching user right after starting a call is safe and lets independent calls run in parallel.
 */
function callAs<T = any>(user: User | null, ...args: Parameters<typeof call>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  actAs(user);
  return call<T>(...args);
}

async function attemptQuestionIds(attemptId: string) {
  const rows = await prisma.attemptQuestion.findMany({ where: { attemptId }, select: { id: true, questionId: true } });
  return Object.fromEntries(rows.map((row) => [row.questionId, row.id]));
}

function save(user: User, attemptId: string, items: { questionId: string; response: unknown }[]) {
  return callAs(user, saveAnswers, {
    method: "PUT",
    path: `/api/attempts/${attemptId}/answers`,
    body: { items: items.map((item, index) => ({ ...item, flagged: false, seq: index + 1, elapsedMs: 1_000 })) },
  });
}

async function loadAnswerIds(attemptId: string, name: string) {
  const rows = await prisma.answer.findMany({
    where: { attemptQuestion: { attemptId } },
    select: { id: true, attemptQuestion: { select: { questionId: true } } },
  });
  for (const row of rows) answers[`${name}:${row.attemptQuestion.questionId}`] = row.id;
}

beforeAll(async () => {
  await cleanupTestData();
  [examiner, other, admin, alice, bob, carol] = await Promise.all([
    makeUser(Role.EXAMINER),
    makeUser(Role.EXAMINER),
    makeUser(Role.ADMIN),
    makeUser(Role.CANDIDATE, { name: "Alice Grade" }),
    makeUser(Role.CANDIDATE, { name: "Bob Grade" }),
    makeUser(Role.CANDIDATE, { name: "Carol Grade" }),
  ]);
  const [mcq, w1, w2, exam] = await Promise.all([
    makeQuestion(examiner.id, { type: "MCQ", text: "2 + 2 = ?" }),
    makeQuestion(examiner.id, { type: "WRITTEN", text: "Explain recursion." }),
    makeQuestion(examiner.id, { type: "WRITTEN", text: "Explain closures." }),
    makeExam(examiner.id, {
      status: "PUBLISHED",
      startAt: new Date(Date.now() - 60_000),
      endAt: new Date(Date.now() + 3_600_000),
    }),
  ]);
  [mcqId, w1Id, w2Id, examId] = [mcq.id, w1.id, w2.id, exam.id];
  await Promise.all([
    prisma.examQuestion.createMany({
      data: [
        { examId, questionId: mcqId, marks: 2, order: 1 },
        { examId, questionId: w1Id, marks: 5, order: 2 },
        { examId, questionId: w2Id, marks: 3, order: 3 },
      ],
    }),
    prisma.enrollment.createMany({ data: [alice, bob, carol].map((user) => ({ examId, userId: user.id })) }),
  ]);
  await prisma.exam.update({ where: { id: examId }, data: { totalMarks: 10 } });

  // Start every attempt through Member 1's route (candidates + the examiner's sandbox).
  const path = `/api/exams/${examId}/attempts`;
  const started = await Promise.all([
    callAs(alice, startAttempt, { method: "POST", path, body: {} }),
    callAs(bob, startAttempt, { method: "POST", path, body: {} }),
    callAs(carol, startAttempt, { method: "POST", path, body: {} }),
    callAs(examiner, startAttempt, { method: "POST", path, body: { sandbox: true } }),
  ]);
  for (const result of started) expect(result.status).toBe(201);
  [attempts.alice, attempts.bob, attempts.carol, attempts.sandbox] = started.map((r) => r.body.attemptId);

  const [aq, bq, cq, sq] = await Promise.all(
    [attempts.alice, attempts.bob, attempts.carol, attempts.sandbox].map(attemptQuestionIds),
  );
  const mcqOptions = mcq.options; // option 1 is correct
  const saved = await Promise.all([
    save(alice, attempts.alice, [
      { questionId: aq[mcqId], response: { optionIds: [mcqOptions[0].id] } },
      { questionId: aq[w1Id], response: { text: "A function that calls itself." } },
      { questionId: aq[w2Id], response: { text: "A function with its scope." } },
    ]),
    save(bob, attempts.bob, [
      { questionId: bq[mcqId], response: { optionIds: [mcqOptions[1].id] } },
      { questionId: bq[w1Id], response: { text: "Not sure." } },
    ]),
    save(carol, attempts.carol, [{ questionId: cq[w1Id], response: { text: "Recursion is recursion." } }]),
    save(examiner, attempts.sandbox, [{ questionId: sq[w1Id], response: { text: "Sandbox answer" } }]),
  ]);
  for (const result of saved) expect(result.body.results.every((r: { status: string }) => r.status === "saved")).toBe(true);

  const submitted = await Promise.all([
    callAs(alice, submitAttempt, { method: "POST", path: `/api/attempts/${attempts.alice}/submit` }),
    callAs(bob, submitAttempt, { method: "POST", path: `/api/attempts/${attempts.bob}/submit` }),
    callAs(examiner, submitAttempt, { method: "POST", path: `/api/attempts/${attempts.sandbox}/submit` }),
  ]);
  for (const result of submitted) expect(result.body.status).toBe("SUBMITTED");

  await Promise.all([
    loadAnswerIds(attempts.alice, "alice"),
    loadAnswerIds(attempts.bob, "bob"),
    loadAnswerIds(attempts.carol, "carol"),
    loadAnswerIds(attempts.sandbox, "sandbox"),
  ]);
}, 400_000);

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe("GET /api/exams/:id/submissions", () => {
  it("guards: 401 logged out, 403 candidate, 404 other examiner", async () => {
    const params = { id: examId };
    const [anon, cand, foreign] = await Promise.all([
      callAs(null, submissions, { params }),
      callAs(alice, submissions, { params }),
      callAs(other, submissions, { params }),
    ]);
    expect(anon.status).toBe(401);
    expect(cand.status).toBe(403);
    expect(foreign.status).toBe(404);
  });

  it("lists real attempts only, with scores, pending written counts and a summary", async () => {
    const res = await callAs(examiner, submissions, { params: { id: examId } });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { attemptId: string }) => i.attemptId).sort()).toEqual(
      [attempts.alice, attempts.bob, attempts.carol].sort(),
    );
    const byId = Object.fromEntries(res.body.items.map((i: { attemptId: string }) => [i.attemptId, i]));
    expect(byId[attempts.alice]).toMatchObject({
      status: "SUBMITTED",
      score: 2,
      totalMarks: 10,
      pendingWritten: 2,
      candidate: { id: alice.id, name: "Alice Grade", email: alice.email },
    });
    expect(byId[attempts.bob]).toMatchObject({ status: "SUBMITTED", score: 0, pendingWritten: 1 });
    expect(byId[attempts.carol]).toMatchObject({ status: "IN_PROGRESS", score: null, pendingWritten: 0, submittedAt: null });
    expect(res.body.summary).toEqual({ total: 3, inProgress: 1, submitted: 2, graded: 0, pendingWritten: 3 });
  });

  it("admins see any exam", async () => {
    const res = await callAs(admin, submissions, { params: { id: examId } });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
  });
});

describe("GET /api/attempts/:id/review", () => {
  it("shows the owner every question in order with answer keys and responses", async () => {
    const res = await callAs(examiner, review, { params: { id: attempts.bob } });
    expect(res.status).toBe(200);
    expect(res.body.attempt).toMatchObject({ id: attempts.bob, status: "SUBMITTED", isSandbox: false, totalMarks: 10 });
    expect(res.body.questions.map((q: { order: number }) => q.order)).toEqual([1, 2, 3]);
    const [q1, q2, q3] = res.body.questions;
    expect(q1).toMatchObject({ type: "MCQ", marks: 2, questionId: mcqId, answer: { awardedMarks: 0 } });
    expect(q1.options.filter((o: { isCorrect: boolean }) => o.isCorrect)).toHaveLength(1);
    expect(q2).toMatchObject({ type: "WRITTEN", options: [], answer: { response: { text: "Not sure." }, awardedMarks: null } });
    expect(q3).toMatchObject({ type: "WRITTEN", answer: { response: null, awardedMarks: 0 } }); // unanswered -> auto 0
  });

  it("404 for another examiner, 403 for candidates (even their own attempt), 200 for admins", async () => {
    const [foreign, cand, adm] = await Promise.all([
      callAs(other, review, { params: { id: attempts.alice } }),
      callAs(alice, review, { params: { id: attempts.alice } }),
      callAs(admin, review, { params: { id: attempts.alice } }),
    ]);
    expect(foreign.status).toBe(404);
    expect(cand.status).toBe(403);
    expect(adm.status).toBe(200);
  });

  it("sandbox attempts: visible to the exam's examiner (flagged), hidden from admins", async () => {
    const [own, adm] = await Promise.all([
      callAs(examiner, review, { params: { id: attempts.sandbox } }),
      callAs(admin, review, { params: { id: attempts.sandbox } }),
    ]);
    expect(own.status).toBe(200);
    expect(own.body.attempt.isSandbox).toBe(true);
    expect(adm.status).toBe(404);
  });
});

describe("GET /api/exams/:id/grading/queue", () => {
  it("lists ungraded written answers of finalized real attempts with progress", async () => {
    const res = await callAs(examiner, queue, { params: { id: examId } });
    expect(res.status).toBe(200);
    const keys = res.body.items.map((i: { answerId: string }) => i.answerId).sort();
    expect(keys).toEqual([answers[`alice:${w1Id}`], answers[`alice:${w2Id}`], answers[`bob:${w1Id}`]].sort());
    expect(res.body.total).toBe(3);
    // 4 written answers of finalized attempts; bob's empty Q3 was auto-graded 0.
    expect(res.body.progress).toEqual({ graded: 1, total: 4 });
    const item = res.body.items.find((i: { answerId: string }) => i.answerId === answers[`bob:${w1Id}`]);
    expect(item).toMatchObject({
      attemptId: attempts.bob,
      candidate: { id: bob.id, name: "Bob Grade" },
      question: { questionId: w1Id, order: 2, marks: 5, text: "Explain recursion." },
      response: { text: "Not sure." },
    });
    expect(res.body.filters.questions.map((q: { questionId: string }) => q.questionId)).toEqual([w1Id, w2Id]);
    expect(res.body.filters.candidates.map((c: { id: string }) => c.id)).toEqual([alice.id, bob.id]);
  });

  it("filters by question and by candidate", async () => {
    const [byQuestion, byCandidate, both] = await Promise.all([
      callAs(examiner, queue, { params: { id: examId }, path: `/?questionId=${w1Id}` }),
      callAs(examiner, queue, { params: { id: examId }, path: `/?candidateId=${alice.id}` }),
      callAs(examiner, queue, { params: { id: examId }, path: `/?candidateId=${bob.id}&questionId=${w2Id}` }),
    ]);
    expect(byQuestion.body.items.map((i: { candidate: { id: string } }) => i.candidate.id).sort()).toEqual([alice.id, bob.id].sort());
    expect(byCandidate.body.items.map((i: { question: { questionId: string } }) => i.question.questionId)).toEqual([w1Id, w2Id]);
    expect(both.body.items).toEqual([]);
  });

  it("guards: 404 other examiner, 403 candidate", async () => {
    const [foreign, cand] = await Promise.all([
      callAs(other, queue, { params: { id: examId } }),
      callAs(bob, queue, { params: { id: examId } }),
    ]);
    expect(foreign.status).toBe(404);
    expect(cand.status).toBe(403);
  });
});

describe("PATCH /api/answers/:id/grade", () => {
  const patch = (user: User, answerId: string, body: unknown) =>
    callAs(user, grade, { method: "PATCH", params: { id: answerId }, body });

  it("validates marks and feedback (400 with fields)", async () => {
    const id = answers[`alice:${w1Id}`];
    const [over, negative, missing, longFeedback] = await Promise.all([
      patch(examiner, id, { awardedMarks: 5.5 }),
      patch(examiner, id, { awardedMarks: -1 }),
      patch(examiner, id, { feedback: "no marks" }),
      patch(examiner, id, { awardedMarks: 1, feedback: "x".repeat(2001) }),
    ]);
    expect(over.status).toBe(400);
    expect(over.body.error.fields.awardedMarks).toMatch(/more than 5/);
    expect(negative.status).toBe(400);
    expect(negative.body.error.fields.awardedMarks).toBeDefined();
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.awardedMarks).toBeDefined();
    expect(longFeedback.status).toBe(400);
    expect(longFeedback.body.error.fields.feedback).toBeDefined();
  });

  it("409 for objective, in-progress and sandbox answers; 404 for another examiner; 403 candidate", async () => {
    const [mcq, inProgress, sandbox, foreign, cand] = await Promise.all([
      patch(examiner, answers[`alice:${mcqId}`], { awardedMarks: 1 }),
      patch(examiner, answers[`carol:${w1Id}`], { awardedMarks: 1 }),
      patch(examiner, answers[`sandbox:${w1Id}`], { awardedMarks: 1 }),
      patch(other, answers[`alice:${w1Id}`], { awardedMarks: 1 }),
      patch(alice, answers[`alice:${w1Id}`], { awardedMarks: 5 }),
    ]);
    expect(mcq.status).toBe(409);
    expect(inProgress.status).toBe(409);
    expect(sandbox.status).toBe(409);
    expect(foreign.status).toBe(404);
    expect(cand.status).toBe(403);
    const untouched = await prisma.answer.findUniqueOrThrow({ where: { id: answers[`alice:${w1Id}`] } });
    expect(untouched.awardedMarks).toBeNull();
  });

  it("publishing is blocked while attempts are in progress or ungraded (Member 1's endpoint)", async () => {
    const res = await callAs(examiner, publishResults, { method: "POST", path: `/api/exams/${examId}/results/publish` });
    expect(res.status).toBe(409);
    const blockers = res.body.error.details.blockers as { type: string; attemptId: string; count?: number }[];
    expect(blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "IN_PROGRESS", attemptId: attempts.carol }),
        expect.objectContaining({ type: "UNGRADED_WRITTEN", attemptId: attempts.alice, count: 2 }),
        expect.objectContaining({ type: "UNGRADED_WRITTEN", attemptId: attempts.bob, count: 1 }),
      ]),
    );
    expect(blockers.some((b) => b.attemptId === attempts.sandbox)).toBe(false);
  });

  it("grades written answers, re-scores the attempt and marks it GRADED after the last one", async () => {
    const first = await patch(examiner, answers[`alice:${w1Id}`], { awardedMarks: 4.5, feedback: "  Good  " });
    expect(first.status).toBe(200);
    expect(first.body.answer).toMatchObject({ id: answers[`alice:${w1Id}`], awardedMarks: 4.5, feedback: "Good" });
    expect(first.body.attempt).toEqual({ id: attempts.alice, status: "SUBMITTED", score: 6.5 });

    // Regrading before publication is allowed; omitting feedback keeps it.
    const regrade = await patch(examiner, answers[`alice:${w1Id}`], { awardedMarks: 5 });
    expect(regrade.body.answer.feedback).toBe("Good");
    expect(regrade.body.attempt.score).toBe(7);

    const last = await patch(examiner, answers[`alice:${w2Id}`], { awardedMarks: 2.5 });
    expect(last.status).toBe(200);
    expect(last.body.attempt).toEqual({ id: attempts.alice, status: "GRADED", score: 9.5 }); // MCQ 2 + 5 + 2.5

    const [row, audit] = await Promise.all([
      prisma.answer.findUniqueOrThrow({ where: { id: answers[`alice:${w2Id}`] } }),
      prisma.auditLog.count({ where: { action: "grade.update", actorId: examiner.id } }),
    ]);
    expect(row.gradedById).toBe(examiner.id);
    expect(row.gradedAt).toBeInstanceOf(Date);
    expect(audit).toBe(3);

    const progress = await callAs(examiner, queue, { params: { id: examId } });
    expect(progress.body.progress).toEqual({ graded: 3, total: 4 });
  });

  it("lazily finalizes expired attempts so they join the queue", async () => {
    await prisma.attempt.update({
      where: { id: attempts.carol },
      data: { expiresAt: new Date(Date.now() - GRACE_MS - 60_000) },
    });
    const res = await callAs(examiner, submissions, { params: { id: examId } });
    const carolRow = res.body.items.find((i: { attemptId: string }) => i.attemptId === attempts.carol);
    expect(carolRow).toMatchObject({ status: "SUBMITTED", score: 0, pendingWritten: 1 });
    expect(carolRow.submittedAt).toEqual(expect.any(String));
  });

  it("admins can grade too; publishing succeeds once everything is graded", async () => {
    const bobGrade = await patch(admin, answers[`bob:${w1Id}`], { awardedMarks: 0, feedback: "Missing the base case" });
    const carolGrade = await patch(examiner, answers[`carol:${w1Id}`], { awardedMarks: 2 });
    expect(bobGrade.body.attempt).toEqual({ id: attempts.bob, status: "GRADED", score: 0 });
    expect(carolGrade.body.attempt).toEqual({ id: attempts.carol, status: "GRADED", score: 2 });

    const empty = await callAs(examiner, queue, { params: { id: examId } });
    expect(empty.body.items).toEqual([]);
    expect(empty.body.progress).toEqual({ graded: 6, total: 6 });

    const published = await callAs(examiner, publishResults, { method: "POST", path: `/api/exams/${examId}/results/publish` });
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ alreadyPublished: false, reportsIssued: 3 });
  });

  it("grades are locked once results are published (409)", async () => {
    const res = await patch(examiner, answers[`alice:${w1Id}`], { awardedMarks: 1 });
    expect(res.status).toBe(409);
    const row = await prisma.answer.findUniqueOrThrow({ where: { id: answers[`alice:${w1Id}`] } });
    expect(row.awardedMarks).toBe(5);
    const list = await callAs(examiner, submissions, { params: { id: examId } });
    expect(list.body.exam.resultsPublishedAt).toEqual(expect.any(String));
    expect(list.body.summary).toMatchObject({ graded: 3, pendingWritten: 0 });
  });
});
