import { existsSync } from "node:fs";
import { Role, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUT as saveAnswers } from "@/app/api/attempts/[id]/answers/route";
import { POST as submitAttempt } from "@/app/api/attempts/[id]/submit/route";
import { POST as startAttempt } from "@/app/api/exams/[id]/attempts/route";
import { prisma } from "@/lib/prisma";
import { actAs, call, cleanupTestData, makeExam, makeQuestion, makeUser } from "./helpers";

const hasTestDatabase = existsSync(".env.test");

describe.skipIf(!hasTestDatabase)("attempt API concurrency", () => {
  let candidate: User;
  let examId: string;
  let attemptId: string;
  let attemptQuestionId: string;
  let correctOptionId: string;

  beforeAll(async () => {
    await cleanupTestData();
    const examiner = await makeUser(Role.EXAMINER);
    candidate = await makeUser(Role.CANDIDATE);
    const question = await makeQuestion(examiner.id);
    const now = new Date();
    const exam = await makeExam(examiner.id, {
      status: "PUBLISHED",
      startAt: new Date(now.getTime() - 30_000),
      endAt: new Date(now.getTime() + 60 * 60_000),
      durationMin: 60,
    });
    examId = exam.id;
    const correctOption = question.options.find((option) => option.isCorrect);
    if (!correctOption) throw new Error("The test question must have a correct option");
    correctOptionId = correctOption.id;

    await prisma.examQuestion.create({
      data: { examId, questionId: question.id, marks: question.defaultMarks, order: 1 },
    });
    await prisma.enrollment.create({ data: { examId, userId: candidate.id } });

    actAs(candidate);
    const started = await call(startAttempt, {
      method: "POST",
      path: `/api/exams/${examId}/attempts`,
      body: { sandbox: false },
    });
    expect(started.status).toBe(201);
    attemptId = started.body.attemptId;
    const attemptQuestion = await prisma.attemptQuestion.findFirstOrThrow({
      where: { attemptId },
      select: { id: true },
    });
    attemptQuestionId = attemptQuestion.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("handles concurrent autosaves and submits without 5xx responses or duplicate rows", async () => {
    actAs(candidate);
    const saves = Array.from({ length: 10 }, (_, index) =>
      call(saveAnswers, {
        method: "PUT",
        path: `/api/attempts/${attemptId}/answers`,
        body: {
          items: [{
            questionId: attemptQuestionId,
            response: { optionIds: [correctOptionId] },
            flagged: false,
            seq: index + 1,
            elapsedMs: 1_000,
          }],
        },
      }),
    );
    const submits = Array.from({ length: 5 }, () =>
      call(submitAttempt, {
        method: "POST",
        path: `/api/attempts/${attemptId}/submit`,
      }),
    );

    const responses = await Promise.all([...saves, ...submits]);
    expect(responses.map((response) => response.status)).toEqual(Array(15).fill(200));
    expect(responses.some((response) => response.status >= 500)).toBe(false);

    const attempts = await prisma.attempt.findMany({
      where: { examId, userId: candidate.id, sandboxRun: 0 },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("GRADED");

    const questions = await prisma.attemptQuestion.findMany({ where: { attemptId } });
    expect(questions).toHaveLength(1);
    const answers = await prisma.answer.findMany({ where: { attemptQuestionId } });
    expect(answers).toHaveLength(1);
  });
});
