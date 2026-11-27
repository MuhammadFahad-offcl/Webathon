import { Role, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getMonitor } from "@/app/api/exams/[id]/monitor/route";
import { GET as listAnnouncements, POST as postAnnouncement } from "@/app/api/exams/[id]/announcements/route";
import { POST as startAttempt } from "@/app/api/exams/[id]/attempts/route"; // Member 1
import { PUT as saveAnswers } from "@/app/api/attempts/[id]/answers/route"; // Member 1
import { POST as recordIncident } from "@/app/api/attempts/[id]/incidents/route"; // Member 1
import { POST as heartbeat } from "@/app/api/attempts/[id]/heartbeat/route"; // Member 1
import { GRACE_MS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { actAs, call, cleanupTestData, makeExam, makeQuestion, makeUser } from "./helpers";

let examiner: User;
let otherExaminer: User;
let admin: User;
let candA: User; // in progress, 1 of 2 answered, one incident
let candB: User; // submitted
let candC: User; // enrolled, not started
let candD: User; // expired beyond grace (inserted directly)
let outsider: User; // candidate not enrolled
let examId: string;
let draftExamId: string;
let endedExamId: string;
let attemptA: string;
let attemptD: string;

const monitorPath = (id: string, query = "") => `/api/exams/${id}/monitor${query}`;

beforeAll(async () => {
  await cleanupTestData();
  [examiner, otherExaminer, admin, candA, candB, candC, candD, outsider] = await Promise.all([
    makeUser(Role.EXAMINER),
    makeUser(Role.EXAMINER),
    makeUser(Role.ADMIN),
    makeUser(Role.CANDIDATE, { name: "Alice Monitor" }),
    makeUser(Role.CANDIDATE, { name: "Bob Monitor" }),
    makeUser(Role.CANDIDATE, { name: "Cara Monitor" }),
    makeUser(Role.CANDIDATE, { name: "Dan Monitor" }),
    makeUser(Role.CANDIDATE, { name: "Olly Outsider" }),
  ]);
  const now = Date.now();
  const [mcq, written, exam, draft, ended] = await Promise.all([
    makeQuestion(examiner.id, { type: "MCQ" }),
    makeQuestion(examiner.id, { type: "WRITTEN" }),
    // Window already open: started a minute ago, ends in an hour.
    makeExam(examiner.id, { status: "PUBLISHED", startAt: new Date(now - 60_000), endAt: new Date(now + 3_600_000), durationMin: 30 }),
    makeExam(examiner.id),
    makeExam(examiner.id, { status: "PUBLISHED", startAt: new Date(now - 3 * 3_600_000), endAt: new Date(now - 3_600_000) }),
  ]);
  examId = exam.id;
  draftExamId = draft.id;
  endedExamId = ended.id;

  await Promise.all([
    prisma.examQuestion.createMany({
      data: [
        { examId, questionId: mcq.id, marks: 2, order: 1 },
        { examId, questionId: written.id, marks: 5, order: 2 },
      ],
    }),
    prisma.enrollment.createMany({ data: [candA, candB, candC, candD].map((user) => ({ examId, userId: user.id })) }),
  ]);

  // D's attempt expired well past the grace window and was never finalized.
  const expiredAt = new Date(now - GRACE_MS - 60_000);
  const inserted = await prisma.attempt.create({
    data: {
      examId,
      userId: candD.id,
      startedAt: new Date(expiredAt.getTime() - 30 * 60_000),
      expiresAt: expiredAt,
      questions: {
        create: [{
          questionId: mcq.id,
          order: 1,
          marks: 2,
          snapshot: {
            type: "MCQ", text: mcq.text, topic: mcq.topic, difficulty: mcq.difficulty, negativeMarks: 0,
            multiScheme: "ALL_OR_NOTHING", options: mcq.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
          },
        }],
      },
    },
  });
  attemptD = inserted.id;
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe("live attempts feed the monitor (Member 1 engine)", () => {
  it("candidates start, answer, raise an incident, finish; the examiner runs a sandbox", async () => {
    actAs(candA);
    const startedA = await call(startAttempt, { method: "POST", path: `/api/exams/${examId}/attempts`, body: {} });
    expect(startedA.status).toBe(201);
    attemptA = startedA.body.attemptId;

    actAs(candB);
    const startedB = await call(startAttempt, { method: "POST", path: `/api/exams/${examId}/attempts`, body: {} });
    expect(startedB.status).toBe(201);

    const questions = await prisma.attemptQuestion.findMany({ where: { attemptId: attemptA } });
    const mcqQ = questions.find((q) => (q.snapshot as { type: string }).type === "MCQ")!;
    const writtenQ = questions.find((q) => (q.snapshot as { type: string }).type === "WRITTEN")!;
    const optionId = (mcqQ.snapshot as { options: { id: string }[] }).options[0].id;

    actAs(candA);
    const saved = await call(saveAnswers, {
      method: "PUT",
      path: `/api/attempts/${attemptA}/answers`,
      body: {
        items: [
          { questionId: mcqQ.id, response: { optionIds: [optionId] }, flagged: false, seq: 1, elapsedMs: 1000 },
          // Whitespace only: saved, but not "answered".
          { questionId: writtenQ.id, response: { text: "   " }, flagged: true, seq: 1, elapsedMs: 1200 },
        ],
      },
    });
    expect(saved.body.results.map((r: { status: string }) => r.status)).toEqual(["saved", "saved"]);

    const incident = await call(recordIncident, {
      method: "POST",
      path: `/api/attempts/${attemptA}/incidents`,
      body: { type: "TAB_HIDDEN", meta: { durationMs: 4200 } },
    });
    expect(incident.status).toBe(201);

    // B is done. (Set directly: M1's submit runs ~6 queries in one interactive transaction,
    // which can exceed Prisma's 5 s default over the slow link to the shared test DB.)
    await prisma.attempt.update({
      where: { id: startedB.body.attemptId },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });

    actAs(examiner);
    const sandbox = await call(startAttempt, { method: "POST", path: `/api/exams/${examId}/attempts`, body: { sandbox: true } });
    expect(sandbox.status).toBe(201);
  });
});

describe("GET /api/exams/:id/monitor", () => {
  it("401 logged out, 403 for candidates, 404 for another examiner's exam", async () => {
    actAs(null);
    expect((await call(getMonitor, { path: monitorPath(examId), params: { id: examId } })).status).toBe(401);
    actAs(candA);
    expect((await call(getMonitor, { path: monitorPath(examId), params: { id: examId } })).status).toBe(403);
    actAs(otherExaminer);
    const other = await call(getMonitor, { path: monitorPath(examId), params: { id: examId } });
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe("NOT_FOUND");
  });

  it("counts, per-attempt progress, finalizes the expired attempt and leaves out the sandbox", async () => {
    actAs(examiner);
    const res = await call(getMonitor, { path: monitorPath(examId), params: { id: examId } });
    expect(res.status).toBe(200);
    const body = res.body;
    expect(Date.parse(body.serverNow)).not.toBeNaN();
    expect(body.phase).toBe("ONGOING");
    expect(body.counts).toEqual({ enrolled: 4, notStarted: 1, inProgress: 1, submitted: 2 });

    // Sandbox excluded: only the three candidates' real attempts, sorted by name.
    expect(body.attempts.map((a: { candidate: { name: string } }) => a.candidate.name)).toEqual([
      "Alice Monitor", "Bob Monitor", "Dan Monitor",
    ]);
    expect(body.attempts.some((a: { candidate: { id: string } }) => a.candidate.id === examiner.id)).toBe(false);

    const a = body.attempts.find((x: { attemptId: string }) => x.attemptId === attemptA);
    expect(a).toMatchObject({
      candidate: { id: candA.id, name: "Alice Monitor" },
      status: "IN_PROGRESS",
      answered: 1,
      total: 2,
      incidentCount: 1,
      lateSyncCount: 0,
      lastHeartbeatAt: null,
    });

    const d = body.attempts.find((x: { attemptId: string }) => x.attemptId === attemptD);
    expect(["SUBMITTED", "GRADED"]).toContain(d.status);
    expect(d).toMatchObject({ answered: 0, total: 1 });
    expect((await prisma.attempt.findUniqueOrThrow({ where: { id: attemptD } })).submittedAt).not.toBeNull();

    expect(body.recentIncidents).toHaveLength(1);
    expect(body.recentIncidents[0]).toMatchObject({
      attemptId: attemptA, candidateName: "Alice Monitor", type: "TAB_HIDDEN", meta: { durationMs: 4200 },
    });
    // No candidate emails or answer content leak into the payload.
    expect(JSON.stringify(body)).not.toContain(candA.email);
  });

  it("filters incidents by type and attempt; rejects an unknown type", async () => {
    actAs(admin); // admins see every exam
    const byType = await call(getMonitor, { path: monitorPath(examId, "?type=PASTE"), params: { id: examId } });
    expect(byType.status).toBe(200);
    expect(byType.body.recentIncidents).toEqual([]);
    expect(byType.body.attempts).toHaveLength(3);

    const byAttempt = await call(getMonitor, { path: monitorPath(examId, `?attemptId=${attemptA}&type=TAB_HIDDEN`), params: { id: examId } });
    expect(byAttempt.body.recentIncidents).toHaveLength(1);

    const bad = await call(getMonitor, { path: monitorPath(examId, "?type=HACKING"), params: { id: examId } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toHaveProperty("type");
  });

  it("is empty for an exam nobody has started", async () => {
    actAs(examiner);
    const res = await call(getMonitor, { path: monitorPath(draftExamId), params: { id: draftExamId } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ phase: "DRAFT", counts: { enrolled: 0, notStarted: 0, inProgress: 0, submitted: 0 }, attempts: [], recentIncidents: [] });
  });
});

describe("announcements", () => {
  let first: { id: string; message: string; at: string };

  it("the owner posts (201, audited); validation and state rules hold", async () => {
    actAs(examiner);
    const created = await call(postAnnouncement, { method: "POST", params: { id: examId }, body: { message: "  Ten minutes remaining  " } });
    expect(created.status).toBe(201);
    first = created.body.announcement;
    expect(first).toMatchObject({ id: expect.any(String), message: "Ten minutes remaining", at: expect.any(String) });
    expect(await prisma.auditLog.count({ where: { action: "announcement.create", entityId: examId } })).toBe(1);

    const empty = await call(postAnnouncement, { method: "POST", params: { id: examId }, body: { message: "   " } });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fields).toHaveProperty("message");
    const long = await call(postAnnouncement, { method: "POST", params: { id: examId }, body: { message: "x".repeat(501) } });
    expect(long.status).toBe(400);

    const draft = await call(postAnnouncement, { method: "POST", params: { id: draftExamId }, body: { message: "Hello" } });
    expect(draft.status).toBe(409);
    const ended = await call(postAnnouncement, { method: "POST", params: { id: endedExamId }, body: { message: "Hello" } });
    expect(ended.status).toBe(409);
  });

  it("refuses other examiners (404) and candidates (403) on POST", async () => {
    actAs(otherExaminer);
    expect((await call(postAnnouncement, { method: "POST", params: { id: examId }, body: { message: "Hi" } })).status).toBe(404);
    expect((await call(listAnnouncements, { params: { id: examId } })).status).toBe(404);
    actAs(candA);
    expect((await call(postAnnouncement, { method: "POST", params: { id: examId }, body: { message: "Hi" } })).status).toBe(403);
    actAs(null);
    expect((await call(listAnnouncements, { params: { id: examId } })).status).toBe(401);
  });

  it("enrolled candidates read them (newest last, `since` filter); others are refused", async () => {
    actAs(admin);
    const second = await call(postAnnouncement, { method: "POST", params: { id: examId }, body: { message: "Five minutes remaining" } });
    expect(second.status).toBe(201);

    actAs(candC);
    const all = await call(listAnnouncements, { path: `/api/exams/${examId}/announcements`, params: { id: examId } });
    expect(all.status).toBe(200);
    expect(all.body.items.map((x: { message: string }) => x.message)).toEqual(["Ten minutes remaining", "Five minutes remaining"]);

    const since = await call(listAnnouncements, {
      path: `/api/exams/${examId}/announcements?since=${encodeURIComponent(first.at)}`,
      params: { id: examId },
    });
    expect(since.body.items.map((x: { id: string }) => x.id)).toEqual([second.body.announcement.id]);

    const badSince = await call(listAnnouncements, { path: `/api/exams/${examId}/announcements?since=yesterday`, params: { id: examId } });
    expect(badSince.status).toBe(400);

    actAs(outsider);
    const refused = await call(listAnnouncements, { params: { id: examId } });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("NOT_ENROLLED");
  });

  it("reach the candidate through Member 1's heartbeat with the same fields", async () => {
    actAs(candA);
    const beat = await call(heartbeat, { method: "POST", path: `/api/attempts/${attemptA}/heartbeat`, body: { sinceAnnouncementAt: first.at } });
    expect(beat.status).toBe(200);
    expect(beat.body.announcements).toHaveLength(1);
    expect(beat.body.announcements[0]).toEqual({ id: expect.any(String), message: "Five minutes remaining", at: expect.any(String) });

    actAs(examiner);
    const res = await call(getMonitor, { path: monitorPath(examId), params: { id: examId } });
    const a = res.body.attempts.find((x: { attemptId: string }) => x.attemptId === attemptA);
    expect(a.lastHeartbeatAt).toEqual(expect.any(String));
  });
});
