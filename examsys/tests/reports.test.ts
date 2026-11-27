import { Role, type Exam, type User } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as attemptPdf } from "@/app/api/reports/[attemptId]/pdf/route";
import { GET as examPdf } from "@/app/api/exams/[id]/report/pdf/route";
import { GET as verify } from "@/app/api/verify/[code]/route";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { publishResults } from "@/lib/services/result-service"; // Member 1
import { VERIFY_MAX_PER_MIN, verifyRateLimiter } from "@/lib/server/reports";
import { cleanupTestData, makeExam, makeUser } from "./helpers";

/**
 * PR 9: result statement PDF, exam summary PDF and public verification.
 * Attempts are inserted with prisma (graded, two topics); Member 1's publishResults
 * then issues the Report rows exactly as in production.
 */

let owner: User;
let otherExaminer: User;
let admin: User;
let alice: User; // passes
let bilal: User; // fails
let carol: User; // graded after publication -> no Report row
let exam: Exam;
let aliceAttemptId: string;
let bilalAttemptId: string;
let sandboxAttemptId: string;

/** Calls a handler as `user` and returns the raw Response (PDFs are not JSON). */
async function send(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (request: Request, context: { params: Promise<any> }) => Promise<Response>,
  user: { id: string; role: Role } | null,
  params: Record<string, string>,
  headers: Record<string, string> = {},
) {
  if (user) headers.cookie = `${SESSION_COOKIE}=${await signSession({ userId: user.id, role: user.role })}`;
  return handler(new Request("http://test.local/", { headers }), { params: Promise.resolve(params) });
}
const pdfFor = (user: { id: string; role: Role } | null, attemptId: string) => send(attemptPdf, user, { attemptId });
const verifyCode = (code: string, ip = "198.51.100.7") => send(verify, null, { code }, { "x-forwarded-for": ip });

async function expectPdf(response: Response, filename: string) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"`);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
}

const snapshot = (topic: string, text: string) => ({
  type: "MCQ", text, topic, difficulty: "MEDIUM", negativeMarks: 0, multiScheme: "ALL_OR_NOTHING",
  options: [{ id: "o1", text: "Right", isCorrect: true }, { id: "o2", text: "Wrong", isCorrect: false }],
});

/** A graded real attempt: two Networking questions (2 marks each), one Databases (6 marks). */
function gradedAttempt(userId: string, awarded: [number, number, number], extra: { isSandbox?: boolean; sandboxRun?: number } = {}) {
  const marks = [2, 2, 6];
  const topics = ["Networking", "Networking", "Databases"];
  return prisma.attempt.create({
    data: {
      examId: exam.id,
      userId,
      status: "GRADED",
      startedAt: new Date(Date.now() - 2 * 3_600_000),
      expiresAt: new Date(Date.now() - 3_600_000),
      submittedAt: new Date(Date.now() - 90 * 60_000),
      score: awarded.reduce((a, b) => a + b, 0),
      ...extra,
      questions: {
        create: marks.map((m, i) => ({
          questionId: `q-${i}`,
          order: i + 1,
          marks: m,
          snapshot: snapshot(topics[i], `Question ${i + 1}`),
          answer: { create: { response: { optionIds: [awarded[i] ? "o1" : "o2"] }, awardedMarks: awarded[i] } },
        })),
      },
    },
  });
}

beforeAll(async () => {
  await cleanupTestData();
  [owner, otherExaminer, admin, alice, bilal, carol] = await Promise.all([
    makeUser(Role.EXAMINER),
    makeUser(Role.EXAMINER),
    makeUser(Role.ADMIN),
    makeUser(Role.CANDIDATE, { name: "Ayesha Khan" }),
    makeUser(Role.CANDIDATE, { name: "Bilal" }),
    makeUser(Role.CANDIDATE, { name: "Carol Diaz" }),
  ]);
  await prisma.user.update({ where: { id: alice.id }, data: { rollNo: "R-001" } });
  exam = await makeExam(owner.id, {
    title: "Reports exam",
    status: "PUBLISHED",
    startAt: new Date(Date.now() - 3 * 3_600_000),
    endAt: new Date(Date.now() - 3_600_000),
  });
  await prisma.exam.update({ where: { id: exam.id }, data: { totalMarks: 10 } });
  const [a, b, s] = await Promise.all([
    gradedAttempt(alice.id, [2, 0, 5]), // 7 / 10 -> Pass
    gradedAttempt(bilal.id, [0, 0, 3]), // 3 / 10 -> Fail
    gradedAttempt(owner.id, [2, 2, 6], { isSandbox: true, sandboxRun: 1 }),
  ]);
  aliceAttemptId = a.id;
  bilalAttemptId = b.id;
  sandboxAttemptId = s.id;
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe("GET /api/reports/:attemptId/pdf before results are published", () => {
  it("401 logged out, 409 for the owner examiner, 403 for the candidate, 404 for others", async () => {
    const [anon, staff, own, other, otherStaff] = await Promise.all([
      pdfFor(null, aliceAttemptId),
      pdfFor(owner, aliceAttemptId),
      pdfFor(alice, aliceAttemptId),
      pdfFor(bilal, aliceAttemptId),
      pdfFor(otherExaminer, aliceAttemptId),
    ]);
    expect(anon.status).toBe(401);
    expect(staff.status).toBe(409);
    expect((await staff.json()).error.message).toBe("Publish results first");
    expect(own.status).toBe(403);
    expect((await own.json()).error.code).toBe("FORBIDDEN");
    expect(other.status).toBe(404);
    expect(otherStaff.status).toBe(404);
  });
});

describe("after publishResults (Member 1) issues the reports", () => {
  beforeAll(async () => {
    // Test-only: M1's publishResults uses Prisma's default 5 s interactive-transaction
    // timeout, which ~10 round trips over this slow test link exceed. Widen it here only.
    // (prisma is a Proxy, so swap the method by hand instead of vi.spyOn + mockRestore.)
    const client = prisma as unknown as { $transaction: (arg: unknown, options?: Record<string, unknown>) => Promise<unknown> };
    const original = client.$transaction;
    client.$transaction = (arg: unknown, options?: Record<string, unknown>) =>
      typeof arg === "function"
        ? original.call(prisma, arg, { maxWait: 10_000, timeout: 60_000, ...options })
        : original.call(prisma, arg, options);
    try {
      const published = await publishResults(exam.id, owner.id);
      expect(published).toMatchObject({ alreadyPublished: false, reportsIssued: 2 });
    } finally {
      client.$transaction = original;
    }
  });

  it("serves the result PDF to the owner examiner, an admin and the candidate", async () => {
    const [staff, adminRes, own] = await Promise.all([
      pdfFor(owner, aliceAttemptId),
      pdfFor(admin, aliceAttemptId),
      pdfFor(alice, aliceAttemptId),
    ]);
    await expectPdf(staff, `result-${aliceAttemptId}.pdf`);
    await expectPdf(adminRes, `result-${aliceAttemptId}.pdf`);
    await expectPdf(own, `result-${aliceAttemptId}.pdf`);
    expect(own.headers.get("cache-control")).toContain("no-store");
  });

  it("404 for another examiner, another candidate, a sandbox attempt or an unknown id", async () => {
    const responses = await Promise.all([
      pdfFor(otherExaminer, aliceAttemptId),
      pdfFor(bilal, aliceAttemptId),
      pdfFor(owner, sandboxAttemptId),
      pdfFor(owner, "does-not-exist"),
    ]);
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404]);
  });

  it("409 when results are published but the attempt has no Report row", async () => {
    const late = await gradedAttempt(carol.id, [2, 2, 2]);
    const res = await pdfFor(owner, late.id);
    expect(res.status).toBe(409);
    await prisma.attempt.delete({ where: { id: late.id } });
  });

  it("GET /api/exams/:id/report/pdf: owner and admin get the summary; others are refused", async () => {
    const [own, adminRes, other, candidate, anon] = await Promise.all([
      send(examPdf, owner, { id: exam.id }),
      send(examPdf, admin, { id: exam.id }),
      send(examPdf, otherExaminer, { id: exam.id }),
      send(examPdf, alice, { id: exam.id }),
      send(examPdf, null, { id: exam.id }),
    ]);
    await expectPdf(own, `exam-report-${exam.id}.pdf`);
    await expectPdf(adminRes, `exam-report-${exam.id}.pdf`);
    expect([other.status, candidate.status, anon.status]).toEqual([404, 403, 401]);
  });

  describe("GET /api/verify/:code (public)", () => {
    it("valid code -> masked name, band, nothing private", async () => {
      const report = await prisma.report.findUniqueOrThrow({ where: { attemptId: aliceAttemptId } });
      const res = await verifyCode(report.verifyCode);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(["candidate", "examTitle", "issuedAt", "scoreBand", "valid"]);
      expect(body).toEqual({
        valid: true, examTitle: "Reports exam", issuedAt: report.issuedAt.toISOString(), candidate: "A. K.", scoreBand: "Pass",
      });
      const raw = JSON.stringify(body);
      expect(raw).not.toContain(alice.email);
      expect(raw).not.toContain("Ayesha");
      expect(raw).not.toContain("R-001");

      const failing = await prisma.report.findUniqueOrThrow({ where: { attemptId: bilalAttemptId } });
      expect(await (await verifyCode(failing.verifyCode)).json()).toMatchObject({ valid: true, candidate: "B.", scoreBand: "Fail" });
    });

    it("unknown or malformed code -> 200 { valid: false }", async () => {
      const [unknown, junk] = await Promise.all([verifyCode("0".repeat(32)), verifyCode("<script>")]);
      expect(unknown.status).toBe(200);
      expect(await unknown.json()).toEqual({ valid: false });
      expect(await junk.json()).toEqual({ valid: false });
    });

    it("a tampered score in the database -> { valid: false } (same shape)", async () => {
      const report = await prisma.report.findUniqueOrThrow({ where: { attemptId: bilalAttemptId } });
      await prisma.attempt.update({ where: { id: bilalAttemptId }, data: { score: 9 } });
      const res = await verifyCode(report.verifyCode);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ valid: false });
    });

    it("rate-limits lookups per IP -> 429 RATE_LIMITED", async () => {
      expect(VERIFY_MAX_PER_MIN).toBe(30);
      verifyRateLimiter.reset();
      verifyRateLimiter.configure({ limit: 3 });
      try {
        // Malformed codes never reach the database, so this stays fast.
        for (let i = 0; i < 3; i++) expect((await verifyCode("x", "203.0.113.9")).status).toBe(200);
        const limited = await verifyCode("x", "203.0.113.9");
        expect(limited.status).toBe(429);
        expect((await limited.json()).error.code).toBe("RATE_LIMITED");
        expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
        expect((await verifyCode("x", "203.0.113.10")).status).toBe(200); // other IPs unaffected
      } finally {
        verifyRateLimiter.configure({ limit: VERIFY_MAX_PER_MIN });
        verifyRateLimiter.reset();
      }
    });
  });
});
