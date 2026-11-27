import { Role, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as listExams } from "@/app/api/exams/route";
import { GET as getExam, PATCH as updateExam } from "@/app/api/exams/[id]/route";
import { PUT as assignQuestions } from "@/app/api/exams/[id]/questions/route";
import { POST as publishExam } from "@/app/api/exams/[id]/publish/route";
import { GET as listEnrollments, POST as enroll } from "@/app/api/exams/[id]/enrollments/route";
import { GET as monitor } from "@/app/api/exams/[id]/monitor/route";
import { GET as submissions } from "@/app/api/exams/[id]/submissions/route";
import { GET as gradingQueue } from "@/app/api/exams/[id]/grading/queue/route";
import { PATCH as gradeAnswer } from "@/app/api/answers/[id]/grade/route";
import { GET as examAnalytics } from "@/app/api/exams/[id]/analytics/route";
import { GET as questionAnalytics } from "@/app/api/exams/[id]/questions/analytics/route";
import { GET as attemptPdf } from "@/app/api/reports/[attemptId]/pdf/route";
import { PATCH as updateQuestion } from "@/app/api/questions/[id]/route";
import { POST as startAttempt } from "@/app/api/exams/[id]/attempts/route"; // Member 1
import { GET as loadAttempt } from "@/app/api/attempts/[id]/route"; // Member 1
import { PUT as saveAnswers } from "@/app/api/attempts/[id]/answers/route"; // Member 1
import { POST as heartbeat } from "@/app/api/attempts/[id]/heartbeat/route"; // Member 1
import { POST as submitAttempt } from "@/app/api/attempts/[id]/submit/route"; // Member 1
import { POST as publishResults } from "@/app/api/exams/[id]/results/publish/route"; // Member 1
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { loadExamReport } from "@/lib/server/reports";
import { actAs, call, cleanupTestData, makeExam, makeQuestion, makeUser } from "./helpers";

// Member 1's finalize / publish run in interactive transactions with Prisma's default 5 s timeout,
// too short at ~1 s per round trip to the remote test database (same fix as tests/grading.test.ts).
await vi.hoisted(async () => {
  const { PrismaClient } = await import("@prisma/client");
  (globalThis as { prisma?: unknown }).prisma = new PrismaClient({
    log: ["error"],
    transactionOptions: { timeout: 60_000, maxWait: 30_000 },
  });
});

/**
 * Sandbox ("Preview as candidate", PR 10) isolation, built through the real endpoints.
 *
 * Exam: Q1 MCQ (2 marks, option 1 correct) + Q2 WRITTEN (3 marks); alice + bob enrolled.
 * alice starts, answers both, submits; the examiner grades her written answer (score 4/5).
 * bob never starts. Snapshot every examiner view; then the examiner runs two sandbox previews
 * (one submitted with an ungraded written answer, one left in progress) and every view must
 * be byte-for-byte what it was, with no trace of either sandbox attempt.
 */

let examiner: User, other: User, admin: User, alice: User, bob: User;
let examId: string, mcqId: string, writtenId: string;
let mcqOptionIds: string[];
let aliceAttempt: string;
const sandbox: { first?: string; second?: string } = {};

function callAs<T = any>(user: User | null, ...args: Parameters<typeof call>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  actAs(user);
  return call<T>(...args);
}

/** The PDF route answers with bytes, not JSON, so it is called without the JSON helper. */
async function pdfFor(user: User, attemptId: string) {
  const cookie = `${SESSION_COOKIE}=${await signSession({ userId: user.id, role: user.role })}`;
  const request = new Request(`http://test.local/api/reports/${attemptId}/pdf`, { headers: { cookie } });
  const response = await attemptPdf(request, { params: Promise.resolve({ attemptId }) });
  return { status: response.status, type: response.headers.get("content-type") };
}

const startPath = () => `/api/exams/${examId}/attempts`;

async function attemptQuestionIds(attemptId: string) {
  const rows = await prisma.attemptQuestion.findMany({ where: { attemptId }, select: { id: true, questionId: true } });
  return Object.fromEntries(rows.map((row) => [row.questionId, row.id]));
}

function save(user: User, attemptId: string, items: { questionId: string; response: unknown; flagged?: boolean }[]) {
  return callAs(user, saveAnswers, {
    method: "PUT",
    path: `/api/attempts/${attemptId}/answers`,
    body: { items: items.map((item) => ({ flagged: false, ...item, seq: 1, elapsedMs: 1_000 })) },
  });
}

/** Drops fields that legitimately change between two reads (clock values). */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "serverNow" && key !== "generatedAt")
        .map(([key, inner]) => [key, stable(inner)]),
    );
  }
  return value;
}

/** Every examiner-side view of the exam that counts or lists attempts. */
async function examinerViews() {
  const params = { id: examId };
  actAs(examiner);
  const [detail, list, roster, live, subs, queue, analytics, perQuestion] = await Promise.all([
    call(getExam, { params }),
    call(listExams, { path: "/api/exams" }),
    call(listEnrollments, { params }),
    call(monitor, { path: `/api/exams/${examId}/monitor`, params }),
    call(submissions, { params }),
    call(gradingQueue, { path: `/api/exams/${examId}/grading/queue`, params }),
    call(examAnalytics, { params }),
    call(questionAnalytics, { params }),
  ]);
  for (const res of [detail, list, roster, live, subs, queue, analytics, perQuestion]) expect(res.status).toBe(200);
  const report = await loadExamReport(examId, { userId: examiner.id, role: Role.EXAMINER });
  return {
    detail: detail.body.exam,
    listed: list.body.items.find((item: { id: string }) => item.id === examId),
    roster: roster.body,
    monitor: live.body,
    submissions: subs.body,
    queue: queue.body,
    analytics: analytics.body,
    questionAnalytics: perQuestion.body,
    report: { stats: report.stats, ranking: report.ranking, distribution: report.distribution, awaitingGrading: report.awaitingGrading },
  };
}

let before: Awaited<ReturnType<typeof examinerViews>>;

beforeAll(async () => {
  await cleanupTestData();
  [examiner, other, admin, alice, bob] = await Promise.all([
    makeUser(Role.EXAMINER, { name: "Sandbox Owner" }),
    makeUser(Role.EXAMINER),
    makeUser(Role.ADMIN),
    makeUser(Role.CANDIDATE, { name: "Alice Sandbox" }),
    makeUser(Role.CANDIDATE, { name: "Bob Sandbox" }),
  ]);
  const [mcq, written, exam] = await Promise.all([
    makeQuestion(examiner.id, { type: "MCQ", text: "Pick the first option" }),
    makeQuestion(examiner.id, { type: "WRITTEN", text: "Explain isolation." }),
    makeExam(examiner.id, { title: `Sandbox exam ${Date.now()}` }), // DRAFT, opens tomorrow
  ]);
  [mcqId, writtenId, examId] = [mcq.id, written.id, exam.id];
  mcqOptionIds = mcq.options.map((option) => option.id);

  // Build it the way an examiner does: questions, enrollment, publish.
  const params = { id: examId };
  const [assigned, enrolled] = await Promise.all([
    callAs(examiner, assignQuestions, {
      method: "PUT",
      params,
      body: { items: [{ questionId: mcqId, marks: 2, order: 1 }, { questionId: writtenId, marks: 3, order: 2 }] },
    }),
    callAs(examiner, enroll, { method: "POST", params, body: { userIds: [alice.id, bob.id] } }),
  ]);
  expect(assigned.status).toBe(200);
  expect(enrolled.status).toBe(200);
  expect((await callAs(examiner, publishExam, { method: "POST", params })).status).toBe(200);

  // Fast-forward: open the window now.
  await prisma.exam.update({
    where: { id: examId },
    data: { startAt: new Date(Date.now() - 60_000), endAt: new Date(Date.now() + 3_600_000) },
  });

  // alice takes the exam through Member 1's engine.
  const started = await callAs(alice, startAttempt, { method: "POST", path: startPath(), body: {} });
  expect(started.status).toBe(201);
  aliceAttempt = started.body.attemptId;
  const aq = await attemptQuestionIds(aliceAttempt);
  const saved = await save(alice, aliceAttempt, [
    { questionId: aq[mcqId], response: { optionIds: [mcqOptionIds[0]] } },
    { questionId: aq[writtenId], response: { text: "Each run is separate." } },
  ]);
  expect(saved.body.results.map((r: { status: string }) => r.status)).toEqual(["saved", "saved"]);
  const submitted = await callAs(alice, submitAttempt, { method: "POST", path: `/api/attempts/${aliceAttempt}/submit` });
  expect(submitted.body.status).toBe("SUBMITTED");

  const writtenAnswer = await prisma.answer.findUniqueOrThrow({ where: { attemptQuestionId: aq[writtenId] }, select: { id: true } });
  const graded = await callAs(examiner, gradeAnswer, { method: "PATCH", params: { id: writtenAnswer.id }, body: { awardedMarks: 2 } });
  expect(graded.status).toBe(200);
  expect(graded.body.attempt).toMatchObject({ status: "GRADED", score: 4 });

  before = await examinerViews();
}, 400_000);

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe("who may start a sandbox (Member 1's rules)", () => {
  it("401 logged out; 403 for a candidate, another examiner and an admin", async () => {
    const body = { sandbox: true };
    const [anon, candidate, foreign, adminRes] = await Promise.all([
      callAs(null, startAttempt, { method: "POST", path: startPath(), body }),
      callAs(alice, startAttempt, { method: "POST", path: startPath(), body }),
      callAs(other, startAttempt, { method: "POST", path: startPath(), body }),
      callAs(admin, startAttempt, { method: "POST", path: startPath(), body }),
    ]);
    expect(anon.status).toBe(401);
    expect(candidate.status).toBe(403);
    expect(foreign.status).toBe(403); // Member 1 answers FORBIDDEN (not 404) for a non-owner
    expect(adminRes.status).toBe(403); // the attempt routes admit CANDIDATE + EXAMINER only
    expect(await prisma.attempt.count({ where: { examId, isSandbox: true } })).toBe(0);
  });
});

describe("the exam's examiner previews it as a candidate", () => {
  it("starts, loads, autosaves, heartbeats and submits a sandbox attempt", async () => {
    const started = await callAs(examiner, startAttempt, { method: "POST", path: startPath(), body: { sandbox: true } });
    expect(started.status).toBe(201);
    expect(started.body.resumed).toBe(false);
    sandbox.first = started.body.attemptId as string;

    const loaded = await callAs(examiner, loadAttempt, { path: `/api/attempts/${sandbox.first}` });
    expect(loaded.status).toBe(200);
    expect(loaded.body.attempt).toMatchObject({ status: "IN_PROGRESS" });
    expect(loaded.body.attempt.remainingMs).toBeGreaterThan(0);
    expect(loaded.body.questions).toHaveLength(2);
    expect(JSON.stringify(loaded.body.questions)).not.toContain("isCorrect"); // candidate view, no keys

    const sq = await attemptQuestionIds(sandbox.first);
    const [saved, beat] = await Promise.all([
      save(examiner, sandbox.first, [
        { questionId: sq[mcqId], response: { optionIds: [mcqOptionIds[1]] }, flagged: true }, // wrong
        { questionId: sq[writtenId], response: { text: "A sandbox answer that must never be graded." } },
      ]),
      callAs(examiner, heartbeat, { method: "POST", path: `/api/attempts/${sandbox.first}/heartbeat`, body: {} }),
    ]);
    expect(saved.body.results.map((r: { status: string }) => r.status)).toEqual(["saved", "saved"]);
    expect(beat.status).toBe(200);

    const submitted = await callAs(examiner, submitAttempt, { method: "POST", path: `/api/attempts/${sandbox.first}/submit` });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("SUBMITTED"); // written answer pending, like a real attempt
  });

  it("a second preview works too and gets the next sandboxRun", async () => {
    const started = await callAs(examiner, startAttempt, { method: "POST", path: startPath(), body: { sandbox: true } });
    expect(started.status).toBe(201);
    sandbox.second = started.body.attemptId as string;
    expect(sandbox.second).not.toBe(sandbox.first);
    const rows = await prisma.attempt.findMany({
      where: { id: { in: [sandbox.first!, sandbox.second] } },
      select: { id: true, isSandbox: true, sandboxRun: true, status: true },
    });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId[sandbox.first!]).toMatchObject({ isSandbox: true, sandboxRun: 1, status: "SUBMITTED" });
    expect(byId[sandbox.second]).toMatchObject({ isSandbox: true, sandboxRun: 2, status: "IN_PROGRESS" }); // left running
  });

  it("sandbox answers can't be graded (409)", async () => {
    const sq = await attemptQuestionIds(sandbox.first!);
    const answer = await prisma.answer.findUniqueOrThrow({ where: { attemptQuestionId: sq[writtenId] }, select: { id: true } });
    const res = await callAs(examiner, gradeAnswer, { method: "PATCH", params: { id: answer.id }, body: { awardedMarks: 1 } });
    expect(res.status).toBe(409);
  });
});

describe("the sandbox attempts leave no trace", () => {
  let after: Awaited<ReturnType<typeof examinerViews>>;
  const sandboxIds = () => [sandbox.first!, sandbox.second!];

  beforeAll(async () => {
    after = await examinerViews();
  }, 120_000);

  it("every examiner view is exactly what it was before the previews", () => {
    expect(stable(after)).toEqual(stable(before));
  });

  it("exam detail + list: one attempt, the real one", () => {
    expect(after.detail).toMatchObject({ attemptCount: 1, enrolledCount: 2 });
    expect(after.listed).toMatchObject({ attemptCount: 1 });
  });

  it("enrollments: counts and statuses come from real attempts only", () => {
    expect(after.roster.counts).toEqual({ enrolled: 2, notStarted: 1, inProgress: 0, submitted: 1 });
    const statuses = Object.fromEntries(after.roster.items.map((i: { userId: string; status: string }) => [i.userId, i.status]));
    expect(statuses).toEqual({ [alice.id]: "GRADED", [bob.id]: "NOT_STARTED" });
  });

  it("monitor: no sandbox attempt, count or incident", () => {
    expect(after.monitor.counts).toEqual({ enrolled: 2, notStarted: 1, inProgress: 0, submitted: 1 });
    const ids = after.monitor.attempts.map((a: { attemptId: string }) => a.attemptId);
    expect(ids).toEqual([aliceAttempt]);
    expect(after.monitor.recentIncidents.some((i: { attemptId: string }) => sandboxIds().includes(i.attemptId))).toBe(false);
  });

  it("submissions and the grading queue never list a sandbox attempt", () => {
    expect(after.submissions.items.map((i: { attemptId: string }) => i.attemptId)).toEqual([aliceAttempt]);
    expect(after.submissions.summary).toEqual({ total: 1, inProgress: 0, submitted: 0, graded: 1, pendingWritten: 0 });
    // The first preview left an ungraded written answer: still nothing to grade.
    expect(after.queue.items).toEqual([]);
    expect(after.queue.progress).toEqual({ graded: 1, total: 1 });
    expect(after.queue.filters.candidates.map((c: { id: string }) => c.id)).toEqual([alice.id]);
  });

  it("analytics and per-question analytics: one attempt, alice's answers only", () => {
    expect(after.analytics.counts).toEqual({ enrolled: 2, attempted: 1, graded: 1, pendingGrading: 0, inProgress: 0 });
    expect(after.analytics.score).toMatchObject({ average: 4, highest: 4, lowest: 4 });
    for (const item of after.questionAnalytics.items as { questionId: string; attempts: number }[]) {
      expect(item.attempts).toBe(1);
    }
  });

  it("exam report data: stats and ranking from alice only", () => {
    expect(after.report.stats).toMatchObject({ attempts: 1, average: 4, highest: 4, lowest: 4 });
    expect(after.report.ranking).toEqual([expect.objectContaining({ rank: 1, name: "Alice Sandbox", score: 4, total: 5 })]);
    expect(after.report.awaitingGrading).toBe(0);
  });

  it("results publish ignores the running + ungraded previews; sandbox attempts get no report (PDF 404)", async () => {
    const published = await callAs(examiner, publishResults, { method: "POST", path: `/api/exams/${examId}/results/publish` });
    expect(published.status).toBe(200);
    expect(published.body.reportsIssued).toBe(1);

    const [reports, realPdf, firstPdf, secondPdf] = await Promise.all([
      prisma.report.findMany({ where: { attempt: { examId } }, select: { attemptId: true } }),
      pdfFor(examiner, aliceAttempt),
      pdfFor(examiner, sandbox.first!),
      pdfFor(examiner, sandbox.second!),
    ]);
    expect(reports.map((r) => r.attemptId)).toEqual([aliceAttempt]);
    expect(realPdf).toEqual({ status: 200, type: "application/pdf" });
    expect(firstPdf.status).toBe(404);
    expect(secondPdf.status).toBe(404);
  });
});

describe("previews on a DRAFT exam", () => {
  let draftId: string, draftQuestionId: string;

  beforeAll(async () => {
    const [draft, question] = await Promise.all([
      makeExam(examiner.id, { title: `Sandbox draft ${Date.now()}` }),
      makeQuestion(examiner.id, { type: "MCQ", text: "Only on the draft" }),
    ]);
    [draftId, draftQuestionId] = [draft.id, question.id];
  });

  it("409 while the exam has no questions", async () => {
    const res = await callAs(examiner, startAttempt, { method: "POST", path: `/api/exams/${draftId}/attempts`, body: { sandbox: true } });
    expect(res.status).toBe(409);
  });

  it("Member 1 allows a sandbox on a draft, and it locks neither the exam nor its questions", async () => {
    await prisma.$transaction([
      prisma.examQuestion.create({ data: { examId: draftId, questionId: draftQuestionId, marks: 2, order: 1 } }),
      prisma.exam.update({ where: { id: draftId }, data: { totalMarks: 2 } }),
    ]);
    const started = await callAs(examiner, startAttempt, { method: "POST", path: `/api/exams/${draftId}/attempts`, body: { sandbox: true } });
    expect(started.status).toBe(201);
    const submitted = await callAs(examiner, submitAttempt, { method: "POST", path: `/api/attempts/${started.body.attemptId}/submit` });
    expect(submitted.body.status).toBe("GRADED"); // unanswered MCQ, auto-marked 0

    const params = { id: draftId };
    const detail = await callAs(examiner, getExam, { params });
    expect(detail.body.exam).toMatchObject({ status: "DRAFT", attemptCount: 0, locked: false, lockReason: null });

    const reschedule = await callAs(examiner, updateExam, { method: "PATCH", params, body: { durationMin: 45 } });
    expect(reschedule.status).toBe(200);
    const reassign = await callAs(examiner, assignQuestions, {
      method: "PUT",
      params,
      body: { items: [{ questionId: draftQuestionId, marks: 3, order: 1 }] },
    });
    expect(reassign.status).toBe(200);
    expect(reassign.body.exam).toMatchObject({ durationMin: 45, totalMarks: 3, locked: false });
    const edit = await callAs(examiner, updateQuestion, { method: "PATCH", params: { id: draftQuestionId }, body: { topic: "Edited" } });
    expect(edit.status).toBe(200);
  });
});
