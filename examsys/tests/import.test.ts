import { Role, type Exam, type User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as importCandidates } from "@/app/api/import/candidates/route";
import { POST as importQuestions } from "@/app/api/import/questions/route";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import type { ImportReport } from "@/lib/validation/import";
import { cleanupTestData, makeExam, makeUser, testEmail } from "./helpers";

type Handler = (request: Request) => Promise<Response>;
type Caller = { id: string; role: Role } | null;

/** Uploads `content` as multipart field `file` (like the import dialog does) and returns status + JSON. */
async function upload<T = ImportReport>(
  handler: Handler,
  as: Caller,
  file: { content: string; name?: string; type?: string },
  options: { dryRun?: boolean; examId?: string } = {},
): Promise<{ status: number; body: T }> {
  const form = new FormData();
  form.append("file", new File([file.content], file.name ?? "import.csv", { type: file.type ?? "text/csv" }));
  if (options.examId) form.append("examId", options.examId);
  return send<T>(handler, as, form, options.dryRun);
}

async function send<T>(handler: Handler, as: Caller, body: FormData | string, dryRun?: boolean) {
  const headers: Record<string, string> = {};
  if (as) headers.cookie = `${SESSION_COOKIE}=${await signSession({ userId: as.id, role: as.role })}`;
  if (typeof body === "string") headers["content-type"] = "application/json";
  const request = new Request(`http://test.local/api/import${dryRun ? "?dryRun=true" : ""}`, { method: "POST", headers, body });
  const response = await handler(request);
  const text = await response.text();
  if (response.status >= 500) console.error(`[import] ${response.status} ${text}`);
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

const csv = (...lines: string[]) => `${lines.join("\n")}\n`;
const errorsByRow = (report: ImportReport) => Object.fromEntries(report.rows.map((row) => [row.row, row.errors]));

let examiner: User;
let otherExaminer: User;
let candidateCaller: User;
let existing: User;
let exam: Exam;
let otherExam: Exam;

beforeAll(async () => {
  await cleanupTestData();
  [examiner, otherExaminer, candidateCaller, existing] = await Promise.all([
    makeUser(Role.EXAMINER),
    makeUser(Role.EXAMINER),
    makeUser(Role.CANDIDATE),
    makeUser(Role.CANDIDATE),
  ]);
  [exam, otherExam] = await Promise.all([makeExam(examiner.id), makeExam(otherExaminer.id)]);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe("access control", () => {
  const file = { content: csv("name,email", `Someone,${testEmail("nobody")}`) };

  it("rejects logged-out requests with 401", async () => {
    const results = await Promise.all([upload(importCandidates, null, file), upload(importQuestions, null, file)]);
    expect(results.map((r) => r.status)).toEqual([401, 401]);
  });

  it("rejects candidates with 403", async () => {
    const results = await Promise.all([
      upload(importCandidates, candidateCaller, file),
      upload(importQuestions, candidateCaller, file),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403]);
  });
});

describe("POST /api/import/candidates", () => {
  const emails = {
    withPassword: testEmail("imp"),
    generated: testEmail("imp"),
    generatedRoll: testEmail("imp"),
    shortPassword: testEmail("imp"),
  };
  const mixed = () =>
    csv(
      "name,email,rollNo,password",
      `Ali Khan,${emails.withPassword},R-001,Secret123!`, // 1 valid, own password
      "Bad Email,not-an-email,R-002,", // 2 bad email
      `Sara Ahmed,${emails.generated},,`, // 3 valid, generated password
      `Ali Again,${emails.withPassword.toUpperCase()},R-004,Another123`, // 4 duplicate of row 1
      `Existing Person,${existing.email},R-005,`, // 5 already in the database
      `Short Pw,${emails.shortPassword},R-006,short`, // 6 password too short
      `"Khan, Omar",${emails.generatedRoll},R-007`, // 7 valid, quoted name, password column left out
    );
  const expectedErrors = {
    1: [],
    2: ["email: Enter a valid email address"],
    3: [],
    4: ["email: Same email as row 1"],
    5: ["email: A user with this email already exists"],
    6: ["password: Password must be at least 8 characters"],
    7: [],
  };

  it("dry run reports per-row problems and writes nothing", async () => {
    const { status, body } = await upload(importCandidates, examiner, { content: mixed() }, { dryRun: true });
    expect(status).toBe(200);
    expect(body).toMatchObject({ dryRun: true, total: 7, valid: 3, invalid: 4, imported: 0 });
    expect(errorsByRow(body)).toEqual(expectedErrors);
    expect(body.rows.map((row) => row.status)).toEqual(["valid", "invalid", "valid", "invalid", "invalid", "invalid", "valid"]);
    expect(body.rows[0].label).toBe(`Ali Khan <${emails.withPassword}>`);
    expect(body.credentialsCsv).toBeUndefined();
    expect(await prisma.user.count({ where: { email: { in: Object.values(emails) } } })).toBe(0);
  });

  it("imports the valid rows, reports the invalid ones and returns generated credentials once", async () => {
    const { status, body } = await upload(importCandidates, examiner, { content: mixed() });
    expect(status).toBe(200);
    expect(body).toMatchObject({ dryRun: false, total: 7, valid: 3, invalid: 4, imported: 3 });
    expect(errorsByRow(body)).toEqual(expectedErrors);
    expect(body.rows.map((row) => row.status)).toEqual(["imported", "invalid", "imported", "invalid", "invalid", "invalid", "imported"]);

    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { email: true, name: true, role: true, rollNo: true, passwordHash: true, active: true },
    });
    const byEmail = new Map(users.map((user) => [user.email, user]));
    expect([...byEmail.keys()].sort()).toEqual([emails.withPassword, emails.generated, emails.generatedRoll].sort());
    expect(users.every((user) => user.role === Role.CANDIDATE && user.active)).toBe(true);
    expect(byEmail.get(emails.generatedRoll)).toMatchObject({ name: "Khan, Omar", rollNo: "R-007" });
    expect(byEmail.get(emails.generated)?.rollNo).toBeNull();
    expect(await bcrypt.compare("Secret123!", byEmail.get(emails.withPassword)!.passwordHash)).toBe(true);

    // Only generated passwords are in the CSV, and each one logs in.
    const lines = body.credentialsCsv!.trim().split("\n");
    expect(lines[0]).toBe("email,password");
    const credentials = new Map(lines.slice(1).map((line) => line.split(",") as [string, string]));
    expect([...credentials.keys()].sort()).toEqual([emails.generated, emails.generatedRoll].sort());
    for (const [email, password] of credentials) {
      expect(password.length).toBeGreaterThanOrEqual(12);
      expect(await bcrypt.compare(password, byEmail.get(email)!.passwordHash)).toBe(true);
    }
    expect(JSON.stringify(body)).not.toContain("passwordHash");

    const audit = await prisma.auditLog.findFirst({ where: { actorId: examiner.id, action: "import.candidates" } });
    expect(audit?.meta).toMatchObject({ total: 7, imported: 3, invalid: 4, generatedPasswords: 2 });
  });

  it("enrolls the imported users into the caller's exam", async () => {
    const a = testEmail("enr");
    const b = testEmail("enr");
    const content = csv("Name,Email,Roll No", `Enrol One,${a},E-1`, `Enrol Two,${b},E-2`);
    const { status, body } = await upload(importCandidates, examiner, { content }, { examId: exam.id });
    expect(status).toBe(200);
    expect(body).toMatchObject({ imported: 2, enrollment: { added: 2, alreadyEnrolled: 0, rejected: [] } });
    const enrolled = await prisma.enrollment.findMany({ where: { examId: exam.id }, select: { user: { select: { email: true } } } });
    expect(enrolled.map((row) => row.user.email).sort()).toEqual([a, b].sort());
  });

  it("hides another examiner's exam with 404 and creates nobody", async () => {
    const email = testEmail("enr");
    const results = await Promise.all([
      upload(importCandidates, examiner, { content: csv("name,email", `Nobody Here,${email}`) }, { examId: otherExam.id }),
      upload(importCandidates, examiner, { content: csv("name,email", `Nobody Here,${email}`) }, { examId: otherExam.id, dryRun: true }),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404]);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("accepts a JSON file with the same keys", async () => {
    const email = testEmail("json");
    const rows = [
      { name: "Json Person", email, rollNo: 42, password: "JsonPass123" },
      { name: "X", email: "bad" },
    ];
    const { status, body } = await upload(importCandidates, examiner, {
      content: JSON.stringify(rows),
      name: "people.json",
      type: "application/json",
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ total: 2, imported: 1, invalid: 1 });
    expect(body.rows[1].errors).toEqual(["name: Name must be at least 2 characters", "email: Enter a valid email address"]);
    expect(body.credentialsCsv).toBeUndefined();
    expect(await prisma.user.findUnique({ where: { email }, select: { rollNo: true } })).toEqual({ rollNo: "42" });
  });

  it("rejects a file without the required columns", async () => {
    const { status, body } = await upload<{ error: { code: string; message: string } }>(importCandidates, examiner, {
      content: csv("fullname,mail", "A B,a@b.c"),
    });
    expect(status).toBe(400);
    expect(body.error.message).toContain("Missing columns: name, email");
  });
});

describe("POST /api/import/questions", () => {
  const tag = `imp${Date.now().toString(36)}`;
  const header = "topic,difficulty,type,text,marks,optionA,optionB,optionC,optionD,optionE,optionF,correct,negativeMarks,multiScheme";
  const content = csv(
    header,
    `Networking,EASY,MCQ,${tag} Which layer does IP work at?,2,Transport,Network,Session,,,,B,0.5,`, // 1 valid
    `Networking,MEDIUM,MULTI,${tag} Select transport protocols,3,TCP,HTTP,UDP,FTP,,,A;C,,PARTIAL`, // 2 valid
    `Databases,HARD,WRITTEN,"${tag} Explain normalisation, with an example",10,,,,,,,,,`, // 3 valid
    `Databases,EASY,MCQ,${tag} Bad letter,1,Yes,No,,,,,G,,`, // 4 unknown letter
    `Databases,EASY,MCQ,${tag} Two correct,1,Yes,No,Maybe,,,,A;B,,`, // 5 MCQ with two correct
    `Databases,EASY,ESSAY,${tag} Unknown type,1,,,,,,,,,`, // 6 unknown type
    `Networking,EASY,mcq,${tag} which layer does IP work at?,2,Transport,Network,,,,,B,,`, // 7 duplicate of row 1
    `Databases,EASY,MCQ,${tag} No answer,abc,Yes,No,,,,,,,`, // 8 bad marks + no correct letter
  );

  it("dry run validates with the question-bank rules and writes nothing", async () => {
    const { status, body } = await upload(importQuestions, examiner, { content }, { dryRun: true });
    expect(status).toBe(200);
    expect(body).toMatchObject({ dryRun: true, total: 8, valid: 3, invalid: 5, imported: 0 });
    const errors = errorsByRow(body);
    expect(errors[1]).toEqual([]);
    expect(errors[2]).toEqual([]);
    expect(errors[3]).toEqual([]);
    expect(errors[4]).toEqual(['correct: "G" is not an option letter (A-F)', "options: Mark exactly one option as correct"]);
    expect(errors[5]).toEqual(["options: Mark exactly one option as correct"]);
    expect(errors[6]).toContain("type: Choose MCQ, MULTI or WRITTEN");
    expect(errors[7]).toEqual(["text: Same question as row 1"]);
    expect(errors[8]).toEqual(
      expect.arrayContaining(["correct: Give the correct option letter(s), e.g. A or A;C", "marks: Enter a number"]),
    );
    expect(body.rows[0].label).toBe(`[MCQ] ${tag} Which layer does IP work at?`);
    expect(await prisma.question.count({ where: { text: { startsWith: tag } } })).toBe(0);
  });

  it("creates the valid rows owned by the caller", async () => {
    const { status, body } = await upload(importQuestions, examiner, { content });
    expect(status).toBe(200);
    expect(body).toMatchObject({ dryRun: false, total: 8, valid: 3, invalid: 5, imported: 3 });

    const questions = await prisma.question.findMany({
      where: { text: { startsWith: tag } },
      include: { options: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    expect(questions.map((q) => q.type)).toEqual(["MCQ", "MULTI", "WRITTEN"]); // newest first = file order
    expect(questions.every((q) => q.createdById === examiner.id)).toBe(true);
    const [mcq, multi, written] = questions;
    expect(mcq).toMatchObject({ difficulty: "EASY", defaultMarks: 2, negativeMarks: 0.5, topic: "Networking" });
    expect(mcq.options.map((o) => [o.text, o.isCorrect, o.order])).toEqual([
      ["Transport", false, 1],
      ["Network", true, 2],
      ["Session", false, 3],
    ]);
    expect(multi).toMatchObject({ multiScheme: "PARTIAL", defaultMarks: 3 });
    expect(multi.options.filter((o) => o.isCorrect).map((o) => o.text)).toEqual(["TCP", "UDP"]);
    expect(written).toMatchObject({ text: `${tag} Explain normalisation, with an example`, defaultMarks: 10, options: [] });

    const audit = await prisma.auditLog.findFirst({ where: { actorId: examiner.id, action: "import.questions" } });
    expect(audit?.meta).toMatchObject({ total: 8, imported: 3, invalid: 5 });
  });

  it("accepts JSON (body or file) and rejects questions already in the caller's bank", async () => {
    const rows = [
      { topic: "OS", difficulty: "MEDIUM", type: "MULTI", text: `${tag} Pick schedulers`, marks: 2, options: [
        { text: "Round robin", isCorrect: true }, { text: "FIFO", isCorrect: true }, { text: "HTTP", isCorrect: false },
      ] },
      { topic: "Networking", type: "MCQ", text: `${tag} Which layer does IP work at?`, marks: 2, options: [
        { text: "Transport", isCorrect: false }, { text: "Network", isCorrect: true },
      ] },
    ];
    const viaBody = await send<ImportReport>(importQuestions, examiner, JSON.stringify({ rows }), true);
    expect(viaBody.status).toBe(200);
    expect(viaBody.body).toMatchObject({ dryRun: true, valid: 1, invalid: 1 });
    expect(viaBody.body.rows[1].errors).toEqual(["text: This question is already in your bank"]);

    const viaFile = await upload(importQuestions, examiner, { content: JSON.stringify(rows), name: "q.json", type: "application/json" });
    expect(viaFile.body).toMatchObject({ dryRun: false, imported: 1, invalid: 1 });
    const created = await prisma.question.findFirst({ where: { text: `${tag} Pick schedulers` }, include: { options: true } });
    expect(created).toMatchObject({ createdById: examiner.id, type: "MULTI" });
    expect(created?.options).toHaveLength(3);
  });
});

describe("sample templates", () => {
  it("are fully valid (dry run)", async () => {
    const [candidates, questions] = await Promise.all([
      upload(importCandidates, examiner, { content: readFileSync("public/templates/candidates-sample.csv", "utf8") }, { dryRun: true }),
      upload(importQuestions, otherExaminer, { content: readFileSync("public/templates/questions-sample.csv", "utf8") }, { dryRun: true }),
    ]);
    expect(candidates.body.total).toBe(5);
    // Only "already exists" is tolerated, in case someone imported the sample into the test DB.
    expect(candidates.body.rows.flatMap((row) => row.errors).filter((e) => !e.includes("already exists"))).toEqual([]);
    expect(questions.body).toMatchObject({ total: 7, valid: 7, invalid: 0 });
  });
});

describe("limits", () => {
  it(`rejects more than ${IMPORT_MAX_ROWS} rows with 400`, async () => {
    const lines = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `Person ${i},p${i}@m2test.local`);
    const { status, body } = await upload<{ error: { message: string } }>(importCandidates, examiner, {
      content: csv("name,email", ...lines),
    });
    expect(status).toBe(400);
    expect(body.error.message).toContain(`maximum is ${IMPORT_MAX_ROWS}`);
  });

  it("rejects a file over the size limit with 400", async () => {
    const big = csv("topic,type,text,marks", `T,WRITTEN,${"x".repeat(IMPORT_MAX_BYTES)},1`);
    const { status, body } = await upload<{ error: { message: string } }>(importQuestions, examiner, { content: big });
    expect(status).toBe(400);
    expect(body.error.message).toContain("larger than 2 MB");
  });

  it("rejects an unreadable upload with 400", async () => {
    const results = await Promise.all([
      upload(importQuestions, examiner, { content: "{not json", name: "q.json", type: "application/json" }),
      upload(importQuestions, examiner, { content: "" }),
      send(importQuestions, examiner, JSON.stringify({ nope: true })),
    ]);
    expect(results.map((r) => r.status)).toEqual([400, 400, 400]);
  });
});
