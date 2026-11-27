import { Role, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createQuestion } from "@/app/api/questions/route";
import { DELETE as deleteQuestion, PATCH as updateQuestion } from "@/app/api/questions/[id]/route";
import { POST as createExam } from "@/app/api/exams/route";
import { GET as getExam, PATCH as updateExam } from "@/app/api/exams/[id]/route";
import { PUT as assignQuestions } from "@/app/api/exams/[id]/questions/route";
import { GET as publishCheck } from "@/app/api/exams/[id]/publish-check/route";
import { POST as publishExam } from "@/app/api/exams/[id]/publish/route";
import { GET as listEnrollments, POST as enroll } from "@/app/api/exams/[id]/enrollments/route";
import { DELETE as unenroll } from "@/app/api/exams/[id]/enrollments/[userId]/route";
import { POST as startAttempt } from "@/app/api/exams/[id]/attempts/route"; // Member 1
import { prisma } from "@/lib/prisma";
import { actAs, call, cleanupTestData, makeUser } from "./helpers";

/**
 * End-to-end examiner journey across Member 2's PRs 2-4 and Member 1's attempt engine:
 * question bank -> exam -> assign -> enroll -> review -> publish -> candidate starts ->
 * every "locked once started" rule holds, and an examiner sandbox run leaves no trace.
 */

let examiner: User;
let candidate: User;
let mcqId: string;
let writtenId: string;
let examId: string;

beforeAll(async () => {
  await cleanupTestData();
  [examiner, candidate] = await Promise.all([makeUser(Role.EXAMINER), makeUser(Role.CANDIDATE)]);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe("examiner journey: bank -> exam -> enroll -> publish -> attempt", () => {
  it("builds questions in the bank (PR 2)", async () => {
    actAs(examiner);
    const [mcq, written] = await Promise.all([
      call(createQuestion, {
        method: "POST",
        body: {
          topic: "Flow", type: "MCQ", text: "2 + 2 = ?", defaultMarks: 2,
          options: [{ text: "4", isCorrect: true }, { text: "5", isCorrect: false }],
        },
      }),
      call(createQuestion, {
        method: "POST",
        body: { topic: "Flow", type: "WRITTEN", text: "Explain addition.", defaultMarks: 5 },
      }),
    ]);
    expect(mcq.status).toBe(201);
    expect(written.status).toBe(201);
    mcqId = mcq.body.question.id;
    writtenId = written.body.question.id;
  });

  it("creates an exam and assigns the questions with per-exam marks (PR 3)", async () => {
    const startAt = new Date(Date.now() + 2 * 3_600_000);
    const created = await call(createExam, {
      method: "POST",
      body: {
        title: "Flow exam", instructions: "Answer everything.",
        startAt: startAt.toISOString(), endAt: new Date(startAt.getTime() + 3_600_000).toISOString(), durationMin: 30,
      },
    });
    expect(created.status).toBe(201);
    examId = created.body.exam.id;

    const assigned = await call(assignQuestions, {
      method: "PUT",
      params: { id: examId },
      body: { items: [{ questionId: mcqId, marks: 3, order: 1 }, { questionId: writtenId, marks: 7, order: 2 }] },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.exam.totalMarks).toBe(10);
  });

  it("enrolls a candidate by email (PR 4) and passes the review before publishing", async () => {
    const enrolled = await call(enroll, {
      method: "POST",
      params: { id: examId },
      body: { emails: [candidate.email.toUpperCase()] },
    });
    expect(enrolled.body).toMatchObject({ added: 1, alreadyEnrolled: 0, rejected: [] });

    const check = await call(publishCheck, { params: { id: examId } });
    expect(check.body.ready).toBe(true);
    expect(check.body.summary).toMatchObject({ questionCount: 2, totalMarks: 10, enrolledCount: 1 });

    const published = await call(publishExam, { method: "POST", params: { id: examId } });
    expect(published.status).toBe(200);
    expect(published.body.exam.status).toBe("PUBLISHED");
  });

  it("locks scoring edits on questions used by the published exam (PR 2 x PR 3)", async () => {
    const res = await call(updateQuestion, {
      method: "PATCH",
      params: { id: mcqId },
      body: { options: [{ text: "4", isCorrect: false }, { text: "5", isCorrect: true }] },
    });
    expect(res.status).toBe(409);
    expect((await call(deleteQuestion, { method: "DELETE", params: { id: mcqId } })).status).toBe(409);
  });

  it("lets the enrolled candidate start through Member 1's attempt engine once the window opens", async () => {
    // Fast-forward: open the exam window now (server time drives everything).
    await prisma.exam.update({
      where: { id: examId },
      data: { startAt: new Date(Date.now() - 60_000), endAt: new Date(Date.now() + 3_600_000) },
    });
    actAs(candidate);
    const started = await call(startAttempt, { method: "POST", path: `/api/exams/${examId}/attempts`, body: {} });
    expect(started.status).toBe(201);
    expect(started.body.attemptId).toEqual(expect.any(String));
  });

  it("an examiner sandbox preview is not counted anywhere", async () => {
    actAs(examiner);
    const sandbox = await call(startAttempt, {
      method: "POST",
      path: `/api/exams/${examId}/attempts`,
      body: { sandbox: true },
    });
    expect(sandbox.status).toBe(201);

    const exam = await call(getExam, { params: { id: examId } });
    expect(exam.body.exam).toMatchObject({ attemptCount: 1, locked: true, phase: "ONGOING" });

    const roster = await call(listEnrollments, { params: { id: examId } });
    expect(roster.body.counts).toMatchObject({ enrolled: 1, inProgress: 1, notStarted: 0 });
    expect(roster.body.items[0]).toMatchObject({ userId: candidate.id, status: "IN_PROGRESS" });
  });

  it("refuses changes that would alter a running exam (PR 3 x PR 4 x M1)", async () => {
    const reschedule = await call(updateExam, { method: "PATCH", params: { id: examId }, body: { durationMin: 45 } });
    expect(reschedule.status).toBe(409);

    const retitle = await call(updateExam, { method: "PATCH", params: { id: examId }, body: { title: "Flow exam (final)" } });
    expect(retitle.status).toBe(200);

    const reassign = await call(assignQuestions, {
      method: "PUT",
      params: { id: examId },
      body: { items: [{ questionId: mcqId, marks: 1, order: 1 }] },
    });
    expect(reassign.status).toBe(409);

    const remove = await call(unenroll, { method: "DELETE", params: { id: examId, userId: candidate.id } });
    expect(remove.status).toBe(409);
  });
});
