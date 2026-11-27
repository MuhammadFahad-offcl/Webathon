import { Role, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listExams, POST as createExam } from "@/app/api/exams/route";
import { GET as getExam, PATCH as updateExam } from "@/app/api/exams/[id]/route";
import { PUT as assignQuestions } from "@/app/api/exams/[id]/questions/route";
import { GET as publishCheck } from "@/app/api/exams/[id]/publish-check/route";
import { POST as publishExam } from "@/app/api/exams/[id]/publish/route";
import { prisma } from "@/lib/prisma";
import { actAs, call, cleanupTestData, makeExam, makeQuestion, makeUser } from "./helpers";

const HOUR = 3_600_000;
const inHours = (hours: number) => new Date(Date.now() + hours * HOUR);

let admin: User;
let examiner: User;
let otherExaminer: User;
let candidate: User;

beforeAll(async () => {
  await cleanupTestData();
  [admin, examiner, otherExaminer, candidate] = await Promise.all([
    makeUser(Role.ADMIN),
    makeUser(Role.EXAMINER),
    makeUser(Role.EXAMINER),
    makeUser(Role.CANDIDATE),
  ]);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

const validBody = () => ({
  title: "  Midterm: Databases  ",
  instructions: "Answer all questions.",
  startAt: inHours(24).toISOString(),
  endAt: inHours(26).toISOString(),
  durationMin: 90,
  shuffleQuestions: true,
});

describe("access control", () => {
  it("rejects logged-out requests with 401", async () => {
    actAs(null);
    expect((await call(listExams, { path: "/api/exams" })).status).toBe(401);
    expect((await call(createExam, { method: "POST", body: validBody() })).status).toBe(401);
  });

  it("rejects candidates with 403 on every exam endpoint", async () => {
    const exam = await makeExam(examiner.id);
    actAs(candidate);
    const params = { id: exam.id };
    const results = await Promise.all([
      call(listExams, { path: "/api/exams" }),
      call(createExam, { method: "POST", body: validBody() }),
      call(getExam, { params }),
      call(updateExam, { method: "PATCH", body: { title: "Hacked" }, params }),
      call(assignQuestions, { method: "PUT", body: { items: [] }, params }),
      call(publishCheck, { params }),
      call(publishExam, { method: "POST", params }),
    ]);
    for (const res of results) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("hides another examiner's exam with 404 and lets an admin see everything", async () => {
    const exam = await makeExam(examiner.id, { title: "Owner only exam" });
    const params = { id: exam.id };

    actAs(otherExaminer);
    const [get, patch, put, check, publish, list] = await Promise.all([
      call(getExam, { params }),
      call(updateExam, { method: "PATCH", body: { title: "Taken over" }, params }),
      call(assignQuestions, { method: "PUT", body: { items: [] }, params }),
      call(publishCheck, { params }),
      call(publishExam, { method: "POST", params }),
      call(listExams, { path: "/api/exams" }),
    ]);
    for (const res of [get, patch, put, check, publish]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    expect(list.body.items.map((item: { id: string }) => item.id)).not.toContain(exam.id);

    actAs(admin);
    const [adminGet, adminList] = await Promise.all([
      call(getExam, { params }),
      call(listExams, { path: "/api/exams?search=owner%20only" }),
    ]);
    expect(adminGet.status).toBe(200);
    expect(adminGet.body.exam.createdBy).toEqual({ id: examiner.id, name: examiner.name });
    expect(adminList.body.items.map((item: { id: string }) => item.id)).toContain(exam.id);
  });
});

describe("create exam", () => {
  it("creates a trimmed DRAFT exam with defaults and an audit row", async () => {
    actAs(examiner);
    const res = await call(createExam, { method: "POST", body: validBody() });
    expect(res.status).toBe(201);
    expect(res.body.exam).toMatchObject({
      title: "Midterm: Databases",
      status: "DRAFT",
      phase: "DRAFT",
      durationMin: 90,
      totalMarks: 0,
      shuffleQuestions: true,
      shuffleOptions: false,
      questionCount: 0,
      enrolledCount: 0,
      attemptCount: 0,
      locked: false,
      lockReason: null,
      questions: [],
      createdBy: { id: examiner.id, name: examiner.name },
    });
    const audit = await prisma.auditLog.findFirst({ where: { action: "exam.create", entityId: res.body.exam.id } });
    expect(audit?.actorId).toBe(examiner.id);
  });

  it("rejects an invalid schedule with per-field messages", async () => {
    actAs(examiner);
    const start = inHours(24);
    const [endBeforeStart, tooLong, pastStart, badTypes] = await Promise.all([
      call(createExam, { method: "POST", body: { ...validBody(), endAt: start.toISOString(), startAt: start.toISOString() } }),
      call(createExam, { method: "POST", body: { ...validBody(), durationMin: 121 } }),
      call(createExam, {
        method: "POST",
        body: { ...validBody(), startAt: inHours(-1).toISOString(), endAt: inHours(2).toISOString(), durationMin: 60 },
      }),
      call(createExam, { method: "POST", body: { title: "ab", startAt: "tomorrow", endAt: "", durationMin: 0 } }),
    ]);
    expect(endBeforeStart.status).toBe(400);
    expect(endBeforeStart.body.error.fields.endAt).toMatch(/after the start/);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.fields.durationMin).toMatch(/longer than the exam window \(120 min\)/);
    expect(pastStart.status).toBe(400);
    expect(pastStart.body.error.fields.startAt).toMatch(/future/);
    expect(badTypes.status).toBe(400);
    expect(Object.keys(badTypes.body.error.fields).sort()).toEqual(["durationMin", "endAt", "startAt", "title"]);
  });
});

describe("list + phase derivation", () => {
  it("derives the phase from server time and filters by it", async () => {
    const tag = `phase-${Date.now()}`;
    const [draft, upcoming, ongoing, completed] = await Promise.all([
      makeExam(examiner.id, { title: `${tag} draft` }),
      makeExam(examiner.id, { title: `${tag} upcoming`, status: "PUBLISHED" }),
      makeExam(examiner.id, { title: `${tag} ongoing`, status: "PUBLISHED", startAt: inHours(-1), endAt: inHours(1) }),
      makeExam(examiner.id, { title: `${tag} completed`, status: "PUBLISHED", startAt: inHours(-3), endAt: inHours(-1) }),
    ]);

    actAs(examiner);
    const [all, onlyOngoing, onlyDraft] = await Promise.all([
      call(listExams, { path: `/api/exams?search=${tag}` }),
      call(listExams, { path: `/api/exams?search=${tag}&phase=ONGOING` }),
      call(listExams, { path: `/api/exams?search=${tag}&phase=DRAFT` }),
    ]);
    expect(all.status).toBe(200);
    const phases = Object.fromEntries(all.body.items.map((item: { id: string; phase: string }) => [item.id, item.phase]));
    expect(phases).toEqual({
      [draft.id]: "DRAFT",
      [upcoming.id]: "UPCOMING",
      [ongoing.id]: "ONGOING",
      [completed.id]: "COMPLETED",
    });
    expect(onlyOngoing.body.items.map((item: { id: string }) => item.id)).toEqual([ongoing.id]);
    expect(onlyDraft.body.items.map((item: { id: string }) => item.id)).toEqual([draft.id]);

    const newest = await makeExam(examiner.id, { title: `${tag} newest` });
    const [ordered, bad] = await Promise.all([
      call(listExams, { path: `/api/exams?search=${tag}` }),
      call(listExams, { path: "/api/exams?phase=SOON" }),
    ]);
    expect(ordered.body.items[0].id).toBe(newest.id);
    expect(bad.status).toBe(400);
  });
});

describe("edit lock", () => {
  it("locks the schedule once a real attempt exists, but not for a sandbox attempt", async () => {
    const exam = await makeExam(examiner.id, { status: "PUBLISHED" });
    const params = { id: exam.id };
    actAs(examiner);

    // A sandbox preview must not lock anything.
    await prisma.attempt.create({
      data: { examId: exam.id, userId: examiner.id, isSandbox: true, sandboxRun: 1, expiresAt: inHours(1) },
    });
    const beforeReal = await call(updateExam, { method: "PATCH", body: { durationMin: 45 }, params });
    expect(beforeReal.status).toBe(200);
    expect(beforeReal.body.exam).toMatchObject({ durationMin: 45, locked: false, attemptCount: 0 });

    await prisma.attempt.create({ data: { examId: exam.id, userId: candidate.id, expiresAt: inHours(1) } });
    const [schedule, title, sameValues] = await Promise.all([
      call(updateExam, { method: "PATCH", body: { endAt: inHours(30).toISOString() }, params }),
      call(updateExam, { method: "PATCH", body: { title: "Renamed after start", instructions: "Updated" }, params }),
      // Unchanged locked fields sent along with the form are fine.
      call(updateExam, { method: "PATCH", body: { durationMin: 45 }, params }),
    ]);
    expect(schedule.status).toBe(409);
    expect(schedule.body.error.code).toBe("CONFLICT");
    expect(schedule.body.error.message).toMatch(/already started.*title and instructions/);
    expect(schedule.body.error.details).toEqual({ lockedFields: ["endAt"] });
    expect(title.status).toBe(200);
    expect(title.body.exam).toMatchObject({ locked: true, lockReason: "Candidates have already started this exam.", attemptCount: 1 });
    expect(sameValues.status).toBe(200);

    const stored = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });
    expect(stored.endAt.getTime()).toBe(exam.endAt.getTime());
    expect(stored.title).toBe("Renamed after start");
  });

  it("locks an ongoing exam and re-validates the merged schedule", async () => {
    const [ongoing, draft] = await Promise.all([
      makeExam(examiner.id, { status: "PUBLISHED", startAt: inHours(-1), endAt: inHours(1) }),
      makeExam(examiner.id),
    ]);
    actAs(examiner);
    const [locked, tooLong, pastStart] = await Promise.all([
      call(updateExam, { method: "PATCH", body: { shuffleOptions: true }, params: { id: ongoing.id } }),
      call(updateExam, { method: "PATCH", body: { durationMin: 200 }, params: { id: draft.id } }),
      call(updateExam, { method: "PATCH", body: { startAt: inHours(-2).toISOString() }, params: { id: draft.id } }),
    ]);
    expect(locked.status).toBe(409);
    expect(locked.body.error.message).toMatch(/in progress/);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.fields.durationMin).toMatch(/longer than the exam window/);
    expect(pastStart.status).toBe(400);
    expect(pastStart.body.error.fields.startAt).toMatch(/future/);
  });
});

describe("assign questions", () => {
  it("replaces the list, recomputes totalMarks and orders by `order`", async () => {
    const exam = await makeExam(examiner.id);
    const [q1, q2, q3] = await Promise.all([
      makeQuestion(examiner.id, { type: "MCQ" }),
      makeQuestion(examiner.id, { type: "WRITTEN" }),
      makeQuestion(examiner.id, { type: "MULTI" }),
    ]);
    actAs(examiner);
    const first = await call(assignQuestions, {
      method: "PUT",
      params: { id: exam.id },
      body: { items: [{ questionId: q1.id, marks: 2, order: 2 }, { questionId: q2.id, marks: 5.5, order: 1 }] },
    });
    expect(first.status).toBe(200);
    expect(first.body.exam.totalMarks).toBe(7.5);
    expect(first.body.exam.questions.map((q: { questionId: string }) => q.questionId)).toEqual([q2.id, q1.id]);
    expect(first.body.exam.questions[1]).toMatchObject({ type: "MCQ", marks: 2, optionCount: 4, order: 2 });
    expect(JSON.stringify(first.body)).not.toContain("isCorrect");

    const second = await call(assignQuestions, {
      method: "PUT",
      params: { id: exam.id },
      body: { items: [{ questionId: q3.id, marks: 3, order: 1 }] },
    });
    expect(second.body.exam).toMatchObject({ totalMarks: 3, questionCount: 1 });
    const stored = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id }, include: { questions: true } });
    expect(stored.totalMarks).toBe(3);
    expect(stored.questions.map((row) => row.questionId)).toEqual([q3.id]);
    expect(await prisma.auditLog.count({ where: { action: "exam.questions.assign", entityId: exam.id } })).toBe(2);
  });

  it("rejects another examiner's question, unknown ids and duplicates with 400 on items", async () => {
    const exam = await makeExam(examiner.id);
    const [mine, theirs] = await Promise.all([makeQuestion(examiner.id), makeQuestion(otherExaminer.id)]);
    const params = { id: exam.id };
    actAs(examiner);
    const [foreign, unknown, dupOrder, dupQuestion, badMarks] = await Promise.all([
      call(assignQuestions, { method: "PUT", params, body: { items: [{ questionId: theirs.id, marks: 1, order: 1 }] } }),
      call(assignQuestions, { method: "PUT", params, body: { items: [{ questionId: "nope", marks: 1, order: 1 }] } }),
      call(assignQuestions, {
        method: "PUT",
        params,
        body: { items: [{ questionId: mine.id, marks: 1, order: 1 }, { questionId: theirs.id, marks: 1, order: 1 }] },
      }),
      call(assignQuestions, {
        method: "PUT",
        params,
        body: { items: [{ questionId: mine.id, marks: 1, order: 1 }, { questionId: mine.id, marks: 1, order: 2 }] },
      }),
      call(assignQuestions, { method: "PUT", params, body: { items: [{ questionId: mine.id, marks: 0, order: 1 }] } }),
    ]);
    for (const res of [foreign, unknown, dupOrder, dupQuestion]) {
      expect(res.status).toBe(400);
      expect(res.body.error.fields.items).toBeTruthy();
    }
    expect(badMarks.status).toBe(400);
    expect(badMarks.body.error.fields["items.0.marks"]).toMatch(/greater than 0/);

    // An admin may use anyone's questions.
    actAs(admin);
    const byAdmin = await call(assignQuestions, {
      method: "PUT",
      params,
      body: { items: [{ questionId: mine.id, marks: 1, order: 1 }, { questionId: theirs.id, marks: 1, order: 2 }] },
    });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.exam.totalMarks).toBe(2);
  });

  it("refuses to change questions once a real attempt exists", async () => {
    const exam = await makeExam(examiner.id, { status: "PUBLISHED" });
    const question = await makeQuestion(examiner.id);
    await prisma.attempt.create({ data: { examId: exam.id, userId: candidate.id, expiresAt: inHours(1) } });
    actAs(examiner);
    const res = await call(assignQuestions, {
      method: "PUT",
      params: { id: exam.id },
      body: { items: [{ questionId: question.id, marks: 1, order: 1 }] },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });
});

describe("publish check + publish", () => {
  it("reports blockers for an empty exam and a question without a correct option", async () => {
    const [empty, broken, pastStart] = await Promise.all([
      makeExam(examiner.id),
      makeExam(examiner.id),
      makeExam(examiner.id, { startAt: inHours(-1), endAt: inHours(1) }),
    ]);
    const question = await makeQuestion(examiner.id, { type: "MCQ" });
    await prisma.$transaction([
      prisma.option.updateMany({ where: { questionId: question.id }, data: { isCorrect: false } }),
      prisma.examQuestion.create({ data: { examId: broken.id, questionId: question.id, marks: 2, order: 1 } }),
      prisma.exam.update({ where: { id: broken.id }, data: { totalMarks: 2 } }),
    ]);

    actAs(examiner);
    const [emptyCheck, brokenCheck, pastCheck] = await Promise.all([
      call(publishCheck, { params: { id: empty.id } }),
      call(publishCheck, { params: { id: broken.id } }),
      call(publishCheck, { params: { id: pastStart.id } }),
    ]);
    expect(emptyCheck.status).toBe(200);
    expect(emptyCheck.body.ready).toBe(false);
    expect(emptyCheck.body.blockers).toContain("Add at least one question.");
    expect(emptyCheck.body.warnings.some((w: string) => /No candidates are enrolled/.test(w))).toBe(true);
    expect(emptyCheck.body.summary).toMatchObject({ questionCount: 0, totalMarks: 0, enrolledCount: 0, durationMin: 60 });

    expect(brokenCheck.body.blockers).toEqual(["Question 1 (MCQ) has no correct option."]);
    expect(pastCheck.body.blockers.some((b: string) => /in the past/.test(b))).toBe(true);

    const refused = await call(publishExam, { method: "POST", params: { id: broken.id } });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.blockers).toEqual(["Question 1 (MCQ) has no correct option."]);
  });

  it("publishes a ready exam once, writes an audit row and refuses a second publish", async () => {
    const exam = await makeExam(examiner.id);
    const question = await makeQuestion(examiner.id);
    actAs(examiner);
    await call(assignQuestions, {
      method: "PUT",
      params: { id: exam.id },
      body: { items: [{ questionId: question.id, marks: 4, order: 1 }] },
    });
    await prisma.enrollment.create({ data: { examId: exam.id, userId: candidate.id } });

    const check = await call(publishCheck, { params: { id: exam.id } });
    expect(check.body).toMatchObject({ ready: true, blockers: [] });
    expect(check.body.summary).toMatchObject({ questionCount: 1, totalMarks: 4, enrolledCount: 1 });
    expect(check.body.warnings.some((w: string) => /No candidates/.test(w))).toBe(false);

    const published = await call(publishExam, { method: "POST", params: { id: exam.id } });
    expect(published.status).toBe(200);
    expect(published.body.exam).toMatchObject({ status: "PUBLISHED", phase: "UPCOMING", enrolledCount: 1 });
    expect(Array.isArray(published.body.warnings)).toBe(true);

    const again = await call(publishExam, { method: "POST", params: { id: exam.id } });
    expect(again.status).toBe(409);
    expect(again.body.error.details.blockers).toContain("This exam is already published.");

    const audits = await prisma.auditLog.findMany({ where: { action: "exam.publish", entityId: exam.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(examiner.id);
  });
});

describe("sandbox isolation", () => {
  it("counts only real attempts in list and detail", async () => {
    const exam = await makeExam(examiner.id, { title: `sandbox-count-${Date.now()}`, status: "PUBLISHED" });
    await prisma.attempt.createMany({
      data: [
        { examId: exam.id, userId: examiner.id, isSandbox: true, sandboxRun: 1, expiresAt: inHours(1) },
        { examId: exam.id, userId: examiner.id, isSandbox: true, sandboxRun: 2, expiresAt: inHours(1) },
        { examId: exam.id, userId: candidate.id, expiresAt: inHours(1) },
      ],
    });
    actAs(examiner);
    const [list, detail] = await Promise.all([
      call(listExams, { path: `/api/exams?search=${exam.title}` }),
      call(getExam, { params: { id: exam.id } }),
    ]);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].attemptCount).toBe(1);
    expect(detail.body.exam.attemptCount).toBe(1);
  });
});
