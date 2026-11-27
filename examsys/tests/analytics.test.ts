import { Prisma, Role, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as examAnalytics } from "@/app/api/exams/[id]/analytics/route";
import { GET as questionAnalytics } from "@/app/api/exams/[id]/questions/analytics/route";
import { prisma } from "@/lib/prisma";
import type { ExamAnalytics, QuestionAnalytics, QuestionAnalyticsItem } from "@/lib/validation/analytics";
import { actAs, call, cleanupTestData, makeExam, makeQuestion, makeUser } from "./helpers";

/**
 * Analytics over hand-built attempts (Attempt + AttemptQuestion snapshot + Answer rows) so every
 * number is known. Marks: mcq 2, multi 2, written 4, mcqHard 2 = 10. Option 1 is correct for MCQ,
 * options 1+2 for MULTI (see makeQuestion).
 *
 *        mcq     multi     written            mcqHard  score  %   status     time
 *   A1   o1 ✓    o1,o2 ✓   "full" 4/4         o3        8     80  GRADED     10 min
 *   A2   o2      o1,o3     "half" 2/4         o3        2     20  GRADED     20 min
 *   A3   o2      [] skip   "x" 0/4            o3        0      0  GRADED     30 min
 *   A4   o1 ✓    null skip null skip 0        o2        2     20  GRADED     40 min
 *   A5   o3      o1,o2 ✓   "pending" (null)   o3        2     20  SUBMITTED  90 min (cap 60)
 * Plus one IN_PROGRESS attempt and one sandbox attempt (all correct) that must be ignored.
 */

let owner: User;
let otherExaminer: User;
let admin: User;
let candidate: User;
let examId: string;
let emptyExamId: string;
type Question = Awaited<ReturnType<typeof makeQuestion>>;
const q = {} as Record<"mcq" | "multi" | "written" | "mcqHard", Question>;
type Pick = { key: keyof typeof q; marks: number; response: Prisma.InputJsonValue | null; awarded: number | null };

const snapshotOf = (question: Question) => ({
  type: question.type,
  text: question.text,
  topic: question.topic,
  difficulty: question.difficulty,
  negativeMarks: question.negativeMarks,
  multiScheme: question.multiScheme,
  options: question.options.map((option) => ({ id: option.id, text: option.text, isCorrect: option.isCorrect })),
});
const opt = (key: keyof typeof q, ...indexes: number[]) => ({ optionIds: indexes.map((index) => q[key].options[index - 1].id) });

async function makeAttempt(
  userId: string,
  status: "IN_PROGRESS" | "SUBMITTED" | "GRADED",
  score: number | null,
  minutes: number,
  picks: Pick[],
  sandbox = false,
) {
  const startedAt = new Date(Date.now() - 3 * 3_600_000);
  return prisma.attempt.create({
    data: {
      examId,
      userId,
      status,
      score,
      startedAt,
      expiresAt: status === "IN_PROGRESS" ? new Date(Date.now() + 3_600_000) : new Date(startedAt.getTime() + 60 * 60_000),
      submittedAt: status === "IN_PROGRESS" ? null : new Date(startedAt.getTime() + minutes * 60_000),
      isSandbox: sandbox,
      sandboxRun: sandbox ? 1 : 0,
      questions: {
        create: picks.map((pick, index) => ({
          questionId: q[pick.key].id,
          order: index + 1,
          marks: pick.marks,
          snapshot: snapshotOf(q[pick.key]),
          answer: {
            create: {
              response: pick.response === null ? Prisma.JsonNull : pick.response,
              awardedMarks: pick.awarded,
              seq: 1,
            },
          },
        })),
      },
    },
  });
}

const row = (
  mcq: [Prisma.InputJsonValue | null, number],
  multi: [Prisma.InputJsonValue | null, number],
  written: [Prisma.InputJsonValue | null, number | null],
  mcqHard: [Prisma.InputJsonValue | null, number],
): Pick[] => [
  { key: "mcq", marks: 2, response: mcq[0], awarded: mcq[1] },
  { key: "multi", marks: 2, response: multi[0], awarded: multi[1] },
  { key: "written", marks: 4, response: written[0], awarded: written[1] },
  { key: "mcqHard", marks: 2, response: mcqHard[0], awarded: mcqHard[1] },
];

beforeAll(async () => {
  await cleanupTestData();
  const users = await Promise.all([
    makeUser(Role.EXAMINER),
    makeUser(Role.EXAMINER),
    makeUser(Role.ADMIN),
    ...Array.from({ length: 6 }, () => makeUser(Role.CANDIDATE)),
  ]);
  [owner, otherExaminer, admin, candidate] = users;
  const candidates = users.slice(3);

  [q.mcq, q.multi, q.written, q.mcqHard] = await Promise.all([
    makeQuestion(owner.id, { type: "MCQ", difficulty: "EASY", topic: "Basics", text: "Easy MCQ" }),
    makeQuestion(owner.id, { type: "MULTI", difficulty: "MEDIUM", topic: "Basics", text: "Pick two" }),
    makeQuestion(owner.id, { type: "WRITTEN", difficulty: "HARD", topic: "Essay", text: "Explain" }),
    makeQuestion(owner.id, { type: "MCQ", difficulty: "EASY", topic: "Basics", text: "Trick MCQ" }),
  ]);
  const [exam, emptyExam] = await Promise.all([
    makeExam(owner.id, { status: "PUBLISHED", title: "Analytics exam" }),
    makeExam(owner.id, { status: "PUBLISHED", title: "No attempts yet" }),
  ]);
  examId = exam.id;
  emptyExamId = emptyExam.id;

  await Promise.all([
    prisma.exam.update({
      where: { id: examId },
      data: {
        totalMarks: 10,
        questions: {
          create: [
            { questionId: q.mcq.id, marks: 2, order: 1 },
            { questionId: q.multi.id, marks: 2, order: 2 },
            { questionId: q.written.id, marks: 4, order: 3 },
            { questionId: q.mcqHard.id, marks: 2, order: 4 },
          ],
        },
      },
    }),
    prisma.enrollment.createMany({ data: candidates.map((user) => ({ examId, userId: user.id })) }),
  ]);

  const [c1, c2, c3, c4, c5, c6] = candidates;
  await Promise.all([
    makeAttempt(c1.id, "GRADED", 8, 10, row([opt("mcq", 1), 2], [opt("multi", 1, 2), 2], [{ text: "full" }, 4], [opt("mcqHard", 3), 0])),
    makeAttempt(c2.id, "GRADED", 2, 20, row([opt("mcq", 2), 0], [opt("multi", 1, 3), 0], [{ text: "half" }, 2], [opt("mcqHard", 3), 0])),
    makeAttempt(c3.id, "GRADED", 0, 30, row([opt("mcq", 2), 0], [{ optionIds: [] }, 0], [{ text: "x" }, 0], [opt("mcqHard", 3), 0])),
    makeAttempt(c4.id, "GRADED", 2, 40, row([opt("mcq", 1), 2], [null, 0], [null, 0], [opt("mcqHard", 2), 0])),
    makeAttempt(c5.id, "SUBMITTED", 2, 90, row([opt("mcq", 3), 0], [opt("multi", 1, 2), 2], [{ text: "pending" }, null], [opt("mcqHard", 3), 0])),
    // Ignored: still running, and an examiner sandbox run - both all-correct.
    makeAttempt(c6.id, "IN_PROGRESS", null, 0, row([opt("mcq", 1), 2], [opt("multi", 1, 2), 2], [{ text: "a" }, null], [opt("mcqHard", 1), 2])),
    makeAttempt(owner.id, "GRADED", 10, 5, row([opt("mcq", 1), 2], [opt("multi", 1, 2), 2], [{ text: "b" }, 4], [opt("mcqHard", 1), 2]), true),
  ]);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

const examPath = (id: string) => ({ path: `/api/exams/${id}/analytics`, params: { id } });
const questionsPath = (id: string) => ({ path: `/api/exams/${id}/questions/analytics`, params: { id } });

describe("analytics access", () => {
  it("401 when logged out, 403 for candidates", async () => {
    actAs(null);
    expect((await call(examAnalytics, examPath(examId))).status).toBe(401);
    expect((await call(questionAnalytics, questionsPath(examId))).status).toBe(401);
    actAs(candidate);
    const [exam, questions] = await Promise.all([call(examAnalytics, examPath(examId)), call(questionAnalytics, questionsPath(examId))]);
    expect(exam.status).toBe(403);
    expect(questions.status).toBe(403);
  });

  it("404 for another examiner's exam and for unknown exams", async () => {
    actAs(otherExaminer);
    const [exam, questions, missing] = await Promise.all([
      call(examAnalytics, examPath(examId)),
      call(questionAnalytics, questionsPath(examId)),
      call(examAnalytics, examPath("does-not-exist")),
    ]);
    expect(exam.status).toBe(404);
    expect(exam.body.error.code).toBe("NOT_FOUND");
    expect(questions.status).toBe(404);
    expect(missing.status).toBe(404);
  });

  it("admins see any exam", async () => {
    actAs(admin);
    const response = await call<ExamAnalytics>(examAnalytics, examPath(examId));
    expect(response.status).toBe(200);
    expect(response.body.counts.attempted).toBe(5);
  });
});

describe("GET /api/exams/:id/analytics", () => {
  it("computes statistics from finalized real attempts only", async () => {
    actAs(owner);
    const { status, body } = await call<ExamAnalytics>(examAnalytics, examPath(examId));
    expect(status).toBe(200);
    expect(body.exam).toEqual({ id: examId, title: "Analytics exam", totalMarks: 10, durationMin: 60 });
    expect(body.counts).toEqual({ enrolled: 6, attempted: 5, graded: 4, pendingGrading: 1, inProgress: 1 });
    expect(body.score).toEqual({ average: 2.8, median: 2, highest: 8, lowest: 0 });
    expect(body.percentage).toEqual({ average: 28, median: 20, highest: 80, lowest: 0 });
    expect(body.passPercent).toBe(40);
    expect(body.passRate).toBe(0.2);
    expect([body.passed, body.failed]).toEqual([1, 4]);
    expect(body.avgTimeUsedMin).toBe(32); // (10 + 20 + 30 + 40 + 60 capped) / 5
    expect(body.distribution).toHaveLength(10);
    expect(body.distribution[0]).toEqual({ from: 0, to: 10, count: 1 });
    expect(body.distribution.map((bucket) => bucket.count)).toEqual([1, 0, 3, 0, 0, 0, 0, 0, 1, 0]);
  });

  it("returns sane empty values for an exam without attempts", async () => {
    actAs(owner);
    const { status, body } = await call<ExamAnalytics>(examAnalytics, examPath(emptyExamId));
    expect(status).toBe(200);
    expect(body.counts).toEqual({ enrolled: 0, attempted: 0, graded: 0, pendingGrading: 0, inProgress: 0 });
    expect(body.score).toEqual({ average: null, median: null, highest: null, lowest: null });
    expect(body.passRate).toBeNull();
    expect(body.avgTimeUsedMin).toBeNull();
    expect(body.distribution.every((bucket) => bucket.count === 0)).toBe(true);
  });
});

describe("GET /api/exams/:id/questions/analytics", () => {
  let items: QuestionAnalyticsItem[];
  const byId = (id: string) => items.find((item) => item.questionId === id)!;

  beforeAll(async () => {
    actAs(owner);
    const response = await call<QuestionAnalytics>(questionAnalytics, questionsPath(examId));
    expect(response.status).toBe(200);
    items = response.body.items;
  });

  it("lists each exam question once, in exam order, labelled from the snapshot", () => {
    expect(items.map((item) => item.questionId)).toEqual([q.mcq.id, q.multi.id, q.written.id, q.mcqHard.id]);
    expect(items.every((item) => item.attempts === 5)).toBe(true);
    expect(byId(q.mcq.id)).toMatchObject({ text: "Easy MCQ", topic: "Basics", type: "MCQ", marks: 2 });
  });

  it("MCQ: correct %, most chosen wrong option, declared vs observed difficulty", () => {
    expect(byId(q.mcq.id)).toMatchObject({
      correctPct: 40,
      skippedPct: 0,
      avgMarksPct: 40,
      declaredDifficulty: "EASY",
      observedDifficulty: "MEDIUM",
      mostChosenWrongOption: { optionId: q.mcq.options[1].id, text: "Option 2", count: 2 },
      discrimination: 1,
      flags: [],
    });
  });

  it("MULTI: skipped answers (null and empty) raise HIGH_SKIPPED", () => {
    expect(byId(q.multi.id)).toMatchObject({
      correctPct: 40,
      skippedPct: 40,
      mostChosenWrongOption: { text: "Option 3", count: 1 },
      flags: ["HIGH_SKIPPED"],
    });
  });

  it("WRITTEN: >= 50% of marks counts as correct, pending answers are left out", () => {
    expect(byId(q.written.id)).toMatchObject({
      pendingGrading: 1,
      correctPct: 50,
      skippedPct: 20,
      avgMarksPct: 37.5,
      declaredDifficulty: "HARD",
      observedDifficulty: "MEDIUM",
      mostChosenWrongOption: null,
      discrimination: 1,
      flags: [],
    });
  });

  it("flags a question nobody gets right", () => {
    expect(byId(q.mcqHard.id)).toMatchObject({
      correctPct: 0,
      observedDifficulty: "HARD",
      declaredDifficulty: "EASY",
      mostChosenWrongOption: { text: "Option 3", count: 4 },
      discrimination: 0,
      flags: ["LOW_CORRECT"],
    });
  });

  it("returns no items for an exam without attempts", async () => {
    actAs(owner);
    const { status, body } = await call<QuestionAnalytics>(questionAnalytics, questionsPath(emptyExamId));
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
  });
});
