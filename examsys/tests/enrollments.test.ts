import { Role, type Exam, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as lookupCandidates } from "@/app/api/candidates/route";
import { GET as listEnrollments, POST as enroll } from "@/app/api/exams/[id]/enrollments/route";
import { DELETE as unenroll } from "@/app/api/exams/[id]/enrollments/[userId]/route";
import { prisma } from "@/lib/prisma";
import { actAs, call, cleanupTestData, makeExam, makeUser, testEmail } from "./helpers";

const tag = `enr${Date.now().toString(36)}`;

let owner: User;
let otherExaminer: User;
let admin: User;
let candidateCaller: User;
let inactive: User;
let cands: User[]; // 6 active candidates named "<tag> cand N", rollNo "<TAG>-R<N>"
let exam: Exam;
let otherExam: Exam;

beforeAll(async () => {
  await cleanupTestData();
  [owner, otherExaminer, admin, candidateCaller, inactive] = await Promise.all([
    makeUser(Role.EXAMINER, { name: `${tag} examiner` }),
    makeUser(Role.EXAMINER),
    makeUser(Role.ADMIN, { name: `${tag} admin` }),
    makeUser(Role.CANDIDATE),
    makeUser(Role.CANDIDATE, { name: `${tag} inactive`, active: false }),
  ]);
  const emails = Array.from({ length: 6 }, () => testEmail("cand"));
  await prisma.user.createMany({
    data: emails.map((email, index) => ({
      email,
      name: `${tag} cand ${index}`,
      rollNo: `${tag.toUpperCase()}-R${index}`,
      role: Role.CANDIDATE,
      passwordHash: "not-a-real-hash",
    })),
  });
  cands = await prisma.user.findMany({ where: { email: { in: emails } }, orderBy: { name: "asc" } });
  [exam, otherExam] = await Promise.all([makeExam(owner.id), makeExam(otherExaminer.id)]);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

const enrollPath = (examId: string) => `/api/exams/${examId}/enrollments`;

describe("access control", () => {
  it("rejects logged-out requests with 401", async () => {
    actAs(null);
    expect((await call(lookupCandidates, { path: "/api/candidates" })).status).toBe(401);
    expect((await call(listEnrollments, { path: enrollPath(exam.id), params: { id: exam.id } })).status).toBe(401);
  });

  it("rejects candidates with 403 on every endpoint", async () => {
    actAs(candidateCaller);
    const results = await Promise.all([
      call(lookupCandidates, { path: "/api/candidates" }),
      call(listEnrollments, { params: { id: exam.id } }),
      call(enroll, { method: "POST", body: { userIds: [candidateCaller.id] }, params: { id: exam.id } }),
      call(unenroll, { method: "DELETE", params: { id: exam.id, userId: cands[0].id } }),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403]);
  });

  it("hides another examiner's exam with 404", async () => {
    actAs(owner);
    const results = await Promise.all([
      call(lookupCandidates, { path: `/api/candidates?examId=${otherExam.id}` }),
      call(listEnrollments, { params: { id: otherExam.id } }),
      call(enroll, { method: "POST", body: { userIds: [cands[0].id] }, params: { id: otherExam.id } }),
      call(unenroll, { method: "DELETE", params: { id: otherExam.id, userId: cands[0].id } }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(await prisma.enrollment.count({ where: { examId: otherExam.id } })).toBe(0);
  });
});

describe("candidate lookup", () => {
  it("returns only active CANDIDATE users with minimal fields", async () => {
    actAs(owner);
    const res = await call(lookupCandidates, { path: `/api/candidates?search=${tag}&limit=50` });
    expect(res.status).toBe(200);
    // excludes the inactive candidate, the examiner and the admin who share the tag
    expect(res.body.items.map((u: { id: string }) => u.id).sort()).toEqual(cands.map((c) => c.id).sort());
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(["email", "id", "name", "rollNo"]);
    }
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|"role"|"active"|createdAt/);
  });

  it("searches roll numbers case-insensitively and honours limit", async () => {
    actAs(admin);
    const byRoll = await call(lookupCandidates, { path: `/api/candidates?search=${tag.toLowerCase()}-r3` });
    expect(byRoll.body.items.map((u: { id: string }) => u.id)).toEqual([cands[3].id]);
    const limited = await call(lookupCandidates, { path: `/api/candidates?search=${tag}&limit=2` });
    expect(limited.body.items).toHaveLength(2);
    expect((await call(lookupCandidates, { path: "/api/candidates?limit=51" })).status).toBe(400);
  });

  it("flags candidates already enrolled in the given exam", async () => {
    await prisma.enrollment.create({ data: { examId: exam.id, userId: cands[5].id } });
    actAs(owner);
    const res = await call(lookupCandidates, { path: `/api/candidates?search=${tag}&examId=${exam.id}` });
    expect(res.status).toBe(200);
    const flags = Object.fromEntries(res.body.items.map((u: { id: string; enrolled: boolean }) => [u.id, u.enrolled]));
    expect(flags[cands[5].id]).toBe(true);
    expect(flags[cands[0].id]).toBe(false);
  });
});

describe("enroll", () => {
  it("enrolls by ids and by emails (any case), rejecting non-candidates with reasons", async () => {
    actAs(owner);
    const res = await call(enroll, {
      method: "POST",
      params: { id: exam.id },
      body: {
        userIds: [cands[0].id, cands[0].id, admin.id, "no-such-user", cands[5].id],
        emails: [cands[1].email.toUpperCase(), cands[2].email, cands[0].email, otherExaminer.email, inactive.email, "ghost@m2test.local"],
      },
    });
    expect(res.status).toBe(200);
    // new: cands 0,1,2; cands[5] was already enrolled; duplicates of cands[0] collapse
    expect(res.body.added).toBe(3);
    expect(res.body.alreadyEnrolled).toBe(1);
    const reasons = Object.fromEntries(res.body.rejected.map((r: { value: string; reason: string }) => [r.value, r.reason]));
    expect(reasons).toEqual({
      [admin.id]: "Only candidates can be enrolled",
      "no-such-user": "No user with this id",
      [otherExaminer.email]: "Only candidates can be enrolled",
      [inactive.email]: "This account is inactive",
      "ghost@m2test.local": "No user with this email",
    });

    const enrolled = await prisma.enrollment.findMany({ where: { examId: exam.id }, select: { userId: true } });
    expect(enrolled.map((e) => e.userId).sort()).toEqual([cands[0].id, cands[1].id, cands[2].id, cands[5].id].sort());
    const audit = await prisma.auditLog.findFirst({ where: { action: "enrollment.add", entityId: exam.id }, orderBy: { at: "desc" } });
    expect(audit?.meta).toEqual({ added: 3, alreadyEnrolled: 1, rejected: 5 });
  });

  it("ignores a repeat request gracefully", async () => {
    actAs(owner);
    const res = await call(enroll, { method: "POST", params: { id: exam.id }, body: { userIds: [cands[0].id] } });
    expect(res.body).toEqual({ added: 0, alreadyEnrolled: 1, rejected: [] });
  });

  it("validates the body", async () => {
    actAs(owner);
    const empty = await call(enroll, { method: "POST", params: { id: exam.id }, body: { userIds: [], emails: [] } });
    expect(empty.status).toBe(400);
    expect(empty.body.error.fields.userIds).toBeTruthy();
    const tooMany = await call(enroll, {
      method: "POST",
      params: { id: exam.id },
      body: { userIds: Array.from({ length: 501 }, (_, i) => `id-${i}`) },
    });
    expect(tooMany.status).toBe(400);
  });

  it("lets an admin enroll into any examiner's exam", async () => {
    actAs(admin);
    const res = await call(enroll, { method: "POST", params: { id: otherExam.id }, body: { userIds: [cands[4].id] } });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);
  });

  it("blocks enrollment once the exam has ended or results are published", async () => {
    const [ended, published] = await Promise.all([
      makeExam(owner.id, {
        status: "PUBLISHED",
        startAt: new Date(Date.now() - 3 * 3_600_000),
        endAt: new Date(Date.now() - 3_600_000),
      }),
      makeExam(owner.id, { status: "PUBLISHED" }),
    ]);
    await prisma.exam.update({ where: { id: published.id }, data: { resultsPublishedAt: new Date() } });
    actAs(owner);
    const [a, b] = await Promise.all([
      call(enroll, { method: "POST", params: { id: ended.id }, body: { userIds: [cands[0].id] } }),
      call(enroll, { method: "POST", params: { id: published.id }, body: { userIds: [cands[0].id] } }),
    ]);
    expect([a.status, b.status]).toEqual([409, 409]);
    expect(a.body.error.code).toBe("CONFLICT");
  });
});

describe("list and remove", () => {
  it("lists statuses from real attempts only, with counts", async () => {
    // enrolled so far: cands 0, 1, 2, 5. Add 3 for a graded row.
    await prisma.enrollment.create({ data: { examId: exam.id, userId: cands[3].id } });
    const expiresAt = new Date(Date.now() + 3_600_000);
    await prisma.attempt.createMany({
      data: [
        { examId: exam.id, userId: cands[1].id, expiresAt, status: "IN_PROGRESS" },
        { examId: exam.id, userId: cands[2].id, expiresAt, status: "SUBMITTED" },
        { examId: exam.id, userId: cands[3].id, expiresAt, status: "GRADED", score: 7.5 },
        // a sandbox attempt never counts
        { examId: exam.id, userId: cands[0].id, expiresAt, status: "SUBMITTED", isSandbox: true, sandboxRun: 1 },
      ],
    });

    actAs(owner);
    const res = await call(listEnrollments, { params: { id: exam.id } });
    expect(res.status).toBe(200);
    const byUser = Object.fromEntries(res.body.items.map((i: { userId: string }) => [i.userId, i]));
    expect(byUser[cands[0].id]).toMatchObject({ status: "NOT_STARTED", attemptId: null, score: null, email: cands[0].email });
    expect(byUser[cands[1].id].status).toBe("IN_PROGRESS");
    expect(byUser[cands[1].id].attemptId).toEqual(expect.any(String));
    expect(byUser[cands[2].id].status).toBe("SUBMITTED");
    expect(byUser[cands[3].id]).toMatchObject({ status: "GRADED", score: 7.5, rollNo: cands[3].rollNo });
    expect(byUser[cands[5].id].status).toBe("NOT_STARTED");
    expect(res.body.counts).toEqual({ enrolled: 5, notStarted: 2, inProgress: 1, submitted: 2 });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");

    actAs(admin);
    expect((await call(listEnrollments, { params: { id: exam.id } })).body.counts.enrolled).toBe(5);
  });

  it("removes a candidate who has not started (204), then 404", async () => {
    actAs(owner);
    const params = { id: exam.id, userId: cands[5].id };
    const res = await call(unenroll, { method: "DELETE", params });
    expect(res.status).toBe(204);
    expect(await prisma.enrollment.count({ where: { examId: exam.id, userId: cands[5].id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "enrollment.remove", entityId: exam.id } })).toBe(1);
    expect((await call(unenroll, { method: "DELETE", params })).status).toBe(404);
  });

  it("allows removal when only a sandbox attempt exists, refuses it once a real attempt exists", async () => {
    actAs(owner);
    const sandboxOnly = await call(unenroll, { method: "DELETE", params: { id: exam.id, userId: cands[0].id } });
    expect(sandboxOnly.status).toBe(204);
    const started = await call(unenroll, { method: "DELETE", params: { id: exam.id, userId: cands[1].id } });
    expect(started.status).toBe(409);
    expect(started.body.error.message).toMatch(/already started/);
    expect(await prisma.enrollment.count({ where: { examId: exam.id, userId: cands[1].id } })).toBe(1);
  });
});
