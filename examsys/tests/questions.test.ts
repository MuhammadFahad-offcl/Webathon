import { Role, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listQuestions, POST as createQuestion } from "@/app/api/questions/route";
import { GET as listTopics } from "@/app/api/questions/topics/route";
import {
  DELETE as deleteQuestion,
  GET as getQuestion,
  PATCH as updateQuestion,
} from "@/app/api/questions/[id]/route";
import { POST as duplicateQuestion } from "@/app/api/questions/[id]/duplicate/route";
import { prisma } from "@/lib/prisma";
import type { QuestionDto } from "@/lib/validation/questions";
import { actAs, call, cleanupTestData, makeExam, makeQuestion, makeUser } from "./helpers";

let examiner: User;
let other: User;
let admin: User;
let candidate: User;

const mcq = {
  topic: "Networking",
  difficulty: "EASY",
  type: "MCQ",
  text: "Which layer does TCP live in?",
  defaultMarks: 2,
  negativeMarks: 0.5,
  options: [
    { text: "Transport", isCorrect: true },
    { text: "Network", isCorrect: false },
    { text: "Session", isCorrect: false },
  ],
};

const post = (body: unknown) => call(createQuestion, { method: "POST", path: "/api/questions", body });
const list = (query = "") => call<{ items: QuestionDto[]; page: number; pageSize: number; total: number; totalPages: number }>(
  listQuestions,
  { path: `/api/questions${query}` },
);
const patch = (id: string, body: unknown) => call(updateQuestion, { method: "PATCH", body, params: { id } });

beforeAll(async () => {
  await cleanupTestData();
  [examiner, other, admin, candidate] = await Promise.all([
    makeUser(Role.EXAMINER, { name: "Quiz Master" }),
    makeUser(Role.EXAMINER),
    makeUser(Role.ADMIN),
    makeUser(Role.CANDIDATE),
  ]);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe("access control", () => {
  it("rejects logged-out requests with 401", async () => {
    actAs(null);
    const res = await list();
    expect(res.status).toBe(401);
    expect((res.body as unknown as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects candidates with 403 on every question endpoint", async () => {
    actAs(candidate);
    const params = { id: "anything" };
    const results = await Promise.all([
      list(),
      post(mcq),
      call(listTopics, { path: "/api/questions/topics" }),
      call(getQuestion, { params }),
      patch("anything", { text: "x" }),
      call(deleteQuestion, { method: "DELETE", params }),
      call(duplicateQuestion, { method: "POST", params }),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);
  });
});

describe("create + validation", () => {
  it("creates an MCQ with ordered options and writes an audit row", async () => {
    actAs(examiner);
    const res = await post({ ...mcq, topic: "  Networking  " });
    expect(res.status).toBe(201);
    const q = res.body.question as QuestionDto;
    expect(q).toMatchObject({
      topic: "Networking",
      type: "MCQ",
      difficulty: "EASY",
      defaultMarks: 2,
      negativeMarks: 0.5,
      multiScheme: "ALL_OR_NOTHING",
      usedInExams: 0,
      createdBy: { id: examiner.id, name: "Quiz Master" },
    });
    expect(q.options.map((o) => [o.text, o.isCorrect, o.order])).toEqual([
      ["Transport", true, 1],
      ["Network", false, 2],
      ["Session", false, 3],
    ]);
    expect(new Date(q.createdAt).toISOString()).toBe(q.createdAt);
    const log = await prisma.auditLog.findFirst({ where: { entityId: q.id, action: "question.create" } });
    expect(log?.actorId).toBe(examiner.id);
  });

  it("creates a WRITTEN question with defaults", async () => {
    actAs(examiner);
    const res = await post({ topic: "Essays", type: "WRITTEN", text: "Explain TCP.", defaultMarks: 5 });
    expect(res.status).toBe(201);
    expect(res.body.question).toMatchObject({ difficulty: "MEDIUM", negativeMarks: 0, options: [] });
  });

  it("enforces the per-type rules with field errors", async () => {
    actAs(examiner);
    const opts = (...correct: boolean[]) => correct.map((isCorrect, i) => ({ text: `Option ${i}`, isCorrect }));
    const cases: [unknown, string][] = [
      [{ ...mcq, options: opts(true, true, false) }, "options"], // MCQ two correct
      [{ ...mcq, type: "MULTI", options: opts(false, false) }, "options"], // MULTI none correct
      [{ ...mcq, options: opts(true) }, "options"], // too few
      [{ ...mcq, options: [{ text: "Same", isCorrect: true }, { text: "same ", isCorrect: false }] }, "options"],
      [{ topic: "T", type: "WRITTEN", text: "W", defaultMarks: 2, options: opts(true, false) }, "options"],
      [{ topic: "T", type: "WRITTEN", text: "W", defaultMarks: 2, negativeMarks: 1 }, "negativeMarks"],
      [{ ...mcq, negativeMarks: 3 }, "negativeMarks"], // more than defaultMarks
      [{ ...mcq, defaultMarks: 0 }, "defaultMarks"],
      [{ ...mcq, topic: "" }, "topic"],
    ];
    const results = await Promise.all(cases.map(([body]) => post(body)));
    results.forEach((res, i) => {
      expect(res.status, `case ${i}`).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(res.body.error.fields), `case ${i}`).toContain(cases[i][1]);
    });
  });
});

describe("list, filters, topics, ownership", () => {
  let lister: User;
  beforeAll(async () => {
    lister = await makeUser(Role.EXAMINER);
    await Promise.all([
      makeQuestion(lister.id, { topic: "Algebra", difficulty: "EASY", type: "MCQ", text: "Solve for x" }),
      makeQuestion(lister.id, { topic: "Algebra", difficulty: "HARD", type: "MULTI", text: "Pick the primes" }),
      makeQuestion(lister.id, { topic: "Geometry", difficulty: "HARD", type: "WRITTEN", text: "Prove Pythagoras" }),
      makeQuestion(lister.id, { topic: "Calculus", difficulty: "MEDIUM", type: "MCQ", text: "Derivative of x^2" }),
      makeQuestion(other.id, { topic: "Zoology", text: "Secret question of another examiner" }),
    ]);
  });

  it("lists only the caller's questions, newest first", async () => {
    actAs(lister);
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.items.every((q) => q.createdBy.id === lister.id)).toBe(true);
    const times = res.body.items.map((q) => Date.parse(q.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("filters by topic, difficulty, type and search (text or topic, case-insensitive)", async () => {
    actAs(lister);
    const [topic, difficulty, type, searchText, searchTopic, combined] = await Promise.all([
      list("?topic=algebra"),
      list("?difficulty=HARD"),
      list("?type=MCQ"),
      list("?search=PRIMES"),
      list("?search=geom"),
      list("?topic=Algebra&difficulty=HARD&type=MULTI"),
    ]);
    expect(topic.body.total).toBe(2);
    expect(difficulty.body.items.map((q) => q.difficulty)).toEqual(["HARD", "HARD"]);
    expect(type.body.items.map((q) => q.type)).toEqual(["MCQ", "MCQ"]);
    expect(searchText.body.items.map((q) => q.text)).toEqual(["Pick the primes"]);
    expect(searchTopic.body.items.map((q) => q.topic)).toEqual(["Geometry"]);
    expect(combined.body.total).toBe(1);
  });

  it("paginates", async () => {
    actAs(lister);
    const [page2, bad] = await Promise.all([list("?page=2&pageSize=3"), list("?pageSize=500")]);
    expect(page2.body).toMatchObject({ page: 2, pageSize: 3, total: 4, totalPages: 2 });
    expect(page2.body.items).toHaveLength(1);
    expect(bad.status).toBe(400);
  });

  it("returns sorted distinct topics visible to the caller", async () => {
    actAs(lister);
    const res = await call(listTopics, { path: "/api/questions/topics" });
    expect(res.body.topics).toEqual(["Algebra", "Calculus", "Geometry"]);
  });

  it("hides other examiners' questions (404) but admins see everything", async () => {
    const foreign = await prisma.question.findFirstOrThrow({ where: { createdById: other.id, topic: "Zoology" } });
    actAs(lister);
    const params = { id: foreign.id };
    const denied = await Promise.all([
      call(getQuestion, { params }),
      patch(foreign.id, { text: "hijack" }),
      call(deleteQuestion, { method: "DELETE", params }),
      call(duplicateQuestion, { method: "POST", params }),
    ]);
    expect(denied.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect((await list("?search=Secret")).body.total).toBe(0);

    actAs(admin);
    const [adminGet, adminList, adminTopics] = await Promise.all([
      call(getQuestion, { params }),
      list("?search=Secret question of another"),
      call(listTopics, { path: "/api/questions/topics" }),
    ]);
    expect(adminGet.status).toBe(200);
    expect(adminGet.body.question.createdBy.id).toBe(other.id);
    expect(adminList.body.items.map((q) => q.id)).toContain(foreign.id);
    expect(adminTopics.body.topics).toEqual(expect.arrayContaining(["Algebra", "Zoology"]));
  });
});

describe("update", () => {
  it("updates single fields and replaces options when sent", async () => {
    actAs(examiner);
    const q = await makeQuestion(examiner.id, { type: "MCQ" });
    const text = await patch(q.id, { text: "Updated text", difficulty: "HARD" });
    expect(text.status).toBe(200);
    expect(text.body.question).toMatchObject({ text: "Updated text", difficulty: "HARD", topic: q.topic });
    expect(text.body.question.options.map((o: { id: string }) => o.id)).toEqual(q.options.map((o) => o.id));

    const replaced = await patch(q.id, {
      type: "MULTI",
      multiScheme: "PARTIAL",
      options: [
        { text: "Alpha", isCorrect: true },
        { text: "Beta", isCorrect: true },
      ],
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.question.type).toBe("MULTI");
    expect(replaced.body.question.options.map((o: { text: string; order: number }) => [o.text, o.order])).toEqual([
      ["Alpha", 1],
      ["Beta", 2],
    ]);
    expect(await prisma.option.count({ where: { questionId: q.id } })).toBe(2);
    const log = await prisma.auditLog.findFirst({ where: { entityId: q.id, action: "question.update" }, orderBy: { at: "desc" } });
    expect(log?.meta).toMatchObject({ changed: expect.arrayContaining(["type", "multiScheme", "options"]) });
  });

  it("validates type rules on the merged result", async () => {
    actAs(examiner);
    const q = await makeQuestion(examiner.id, { type: "MCQ" });
    const [toWrittenKeepingOptions, twoCorrect, empty] = await Promise.all([
      patch(q.id, { type: "WRITTEN" }),
      patch(q.id, { options: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: true }] }),
      patch(q.id, {}),
    ]);
    expect(toWrittenKeepingOptions.status).toBe(400);
    expect(toWrittenKeepingOptions.body.error.fields.options).toBeDefined();
    expect(twoCorrect.status).toBe(400);
    expect(twoCorrect.body.error.fields.options).toBeDefined();
    expect(empty.status).toBe(400);

    const toWritten = await patch(q.id, { type: "WRITTEN", options: [] });
    expect(toWritten.status).toBe(200);
    expect(toWritten.body.question).toMatchObject({ type: "WRITTEN", options: [] });
  });

  it("locks scoring fields while the question is in a published exam", async () => {
    actAs(examiner);
    const [q, published, draft] = await Promise.all([
      makeQuestion(examiner.id, { type: "MCQ" }),
      makeExam(examiner.id, { status: "PUBLISHED", title: "Midterm" }),
      makeExam(examiner.id, { title: "Draft paper" }),
    ]);
    const draftOnly = await makeQuestion(examiner.id, { type: "MCQ" });
    await prisma.examQuestion.createMany({
      data: [
        { examId: published.id, questionId: q.id, marks: 2 },
        { examId: draft.id, questionId: draftOnly.id, marks: 2 },
      ],
    });
    const sameOptions = q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect }));

    const [marks, type, options, textEdit, unchangedOptions, draftMarks] = await Promise.all([
      patch(q.id, { defaultMarks: 4 }),
      patch(q.id, { type: "MULTI" }),
      patch(q.id, { options: [...sameOptions].reverse() }),
      patch(q.id, { text: "Reworded", topic: "New topic" }),
      patch(q.id, { options: sameOptions, difficulty: "HARD" }),
      patch(draftOnly.id, { defaultMarks: 4 }),
    ]);
    for (const res of [marks, type, options]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
      expect(res.body.error.message).toMatch(/published exam; duplicate it instead/);
    }
    expect(textEdit.status).toBe(200);
    expect(unchangedOptions.status).toBe(200);
    expect(draftMarks.status).toBe(200);
    expect(draftMarks.body.question.defaultMarks).toBe(4);

    const detail = await call(getQuestion, { params: { id: q.id } });
    expect(detail.body.question.usedInExams).toBe(1);
    expect(detail.body.question.exams).toEqual([{ id: published.id, title: "Midterm", status: "PUBLISHED" }]);
  });
});

describe("delete + duplicate", () => {
  it("refuses to delete a question used in an exam (409 with the exams)", async () => {
    actAs(examiner);
    const [q, exam] = await Promise.all([makeQuestion(examiner.id), makeExam(examiner.id, { title: "Final" })]);
    await prisma.examQuestion.create({ data: { examId: exam.id, questionId: q.id, marks: 2 } });
    const res = await call(deleteQuestion, { method: "DELETE", params: { id: q.id } });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/duplicate/i);
    expect(res.body.error.details).toEqual({ exams: [{ id: exam.id, title: "Final" }] });
  });

  it("deletes an unused question with its options (204)", async () => {
    actAs(examiner);
    const q = await makeQuestion(examiner.id);
    const res = await call(deleteQuestion, { method: "DELETE", params: { id: q.id } });
    expect(res.status).toBe(204);
    const [after, options, log] = await Promise.all([
      call(getQuestion, { params: { id: q.id } }),
      prisma.option.count({ where: { questionId: q.id } }),
      prisma.auditLog.findFirst({ where: { entityId: q.id, action: "question.delete" } }),
    ]);
    expect(after.status).toBe(404);
    expect(options).toBe(0);
    expect(log).not.toBeNull();
  });

  it("duplicates into a copy owned by the caller", async () => {
    const q = await makeQuestion(other.id, { type: "MULTI", text: "Original" });
    actAs(admin);
    const res = await call(duplicateQuestion, { method: "POST", params: { id: q.id } });
    expect(res.status).toBe(201);
    const copy = res.body.question as QuestionDto;
    expect(copy).toMatchObject({ text: "Copy of Original", type: "MULTI", topic: q.topic, usedInExams: 0 });
    expect(copy.createdBy.id).toBe(admin.id);
    expect(copy.id).not.toBe(q.id);
    expect(copy.options.map((o) => [o.text, o.isCorrect, o.order])).toEqual(
      q.options.map((o) => [o.text, o.isCorrect, o.order]),
    );
    expect(copy.options.some((o) => q.options.some((src) => src.id === o.id))).toBe(false);
    expect(await prisma.auditLog.count({ where: { entityId: copy.id, action: "question.duplicate" } })).toBe(1);
  });
});
