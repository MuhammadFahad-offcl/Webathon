import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

/**
 * Every row a test creates is tagged so cleanup only ever touches test data:
 * users get an email ending in TEST_DOMAIN. Safe to run next to the seed data.
 */
export const TEST_DOMAIN = "@m2test.local";
const runId = Math.random().toString(36).slice(2, 8);
let counter = 0;

export const testEmail = (label: string) => `${label}-${runId}-${++counter}${TEST_DOMAIN}`;

let currentUser: { id: string; role: Role } | null = null;

/**
 * Makes the next handler calls run as this user (null = logged out). Requests carry a
 * real session cookie signed by Member 1's `signSession`, so `requireRole` runs unmocked.
 */
export function actAs(user: { id: string; role: Role } | null) {
  currentUser = user;
}

export async function makeUser(role: Role, overrides: { active?: boolean; name?: string } = {}) {
  return prisma.user.create({
    data: {
      name: overrides.name ?? `Test ${role.toLowerCase()}`,
      email: testEmail(role.toLowerCase()),
      role,
      active: overrides.active ?? true,
      passwordHash: "not-a-real-hash",
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, context: { params: Promise<any> }) => Promise<Response>;

/** Calls a route handler like Next.js would and returns status + parsed JSON. */
export async function call<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  handler: Handler,
  options: { method?: string; path?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (currentUser) {
    headers.cookie = `${SESSION_COOKIE}=${await signSession({ userId: currentUser.id, role: currentUser.role })}`;
  }
  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.body !== undefined) {
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    headers["content-type"] = "application/json";
  }
  const request = new Request(`http://test.local${options.path ?? "/"}`, init);
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  const text = await response.text();
  if (response.status >= 500) console.error(`[call] ${init.method} ${options.path ?? "/"} -> ${response.status} ${text}`);
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

type QuestionKind = "MCQ" | "MULTI" | "WRITTEN";

/** A bank question owned by `createdById`. MCQ: option 1 correct; MULTI: options 1+2 correct. */
export async function makeQuestion(
  createdById: string,
  overrides: Partial<{ type: QuestionKind; topic: string; text: string; difficulty: "EASY" | "MEDIUM" | "HARD"; defaultMarks: number }> = {},
) {
  const type = overrides.type ?? "MCQ";
  const options =
    type === "WRITTEN"
      ? []
      : [1, 2, 3, 4].map((order) => ({
          text: `Option ${order}`,
          order,
          isCorrect: order === 1 || (type === "MULTI" && order === 2),
        }));
  return prisma.question.create({
    data: {
      createdById,
      type,
      topic: overrides.topic ?? "Testing",
      difficulty: overrides.difficulty ?? "MEDIUM",
      text: overrides.text ?? `Test ${type} question ${++counter}`,
      defaultMarks: overrides.defaultMarks ?? 2,
      ...(options.length ? { options: { create: options } } : {}),
    },
    include: { options: { orderBy: { order: "asc" } } },
  });
}

/** An exam owned by `createdById`; DRAFT, starting tomorrow for 2 hours, 60 min long. */
export async function makeExam(
  createdById: string,
  overrides: Partial<{ title: string; status: "DRAFT" | "PUBLISHED"; startAt: Date; endAt: Date; durationMin: number }> = {},
) {
  const startAt = overrides.startAt ?? new Date(Date.now() + 24 * 3_600_000);
  return prisma.exam.create({
    data: {
      createdById,
      title: overrides.title ?? `Test exam ${++counter}`,
      status: overrides.status ?? "DRAFT",
      startAt,
      endAt: overrides.endAt ?? new Date(startAt.getTime() + 2 * 3_600_000),
      durationMin: overrides.durationMin ?? 60,
    },
  });
}

/**
 * Deletes everything owned by THIS test file's users (emails contain this run's id),
 * plus leftovers of crashed runs older than 3 hours. Scoped this way, several test
 * runs (e.g. parallel PR branches) can share the one test database safely.
 */
export async function cleanupTestData() {
  const staleBefore = new Date(Date.now() - 3 * 3_600_000);
  const users = await prisma.user.findMany({
    where: {
      email: { endsWith: TEST_DOMAIN },
      OR: [{ email: { contains: `-${runId}-` } }, { createdAt: { lt: staleBefore } }],
    },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;

  const exams = await prisma.exam.findMany({ where: { createdById: { in: ids } }, select: { id: true } });
  const examIds = exams.map((exam) => exam.id);
  const questions = await prisma.question.findMany({ where: { createdById: { in: ids } }, select: { id: true } });
  const questionIds = questions.map((question) => question.id);
  const attempts = await prisma.attempt.findMany({
    where: { OR: [{ examId: { in: examIds } }, { userId: { in: ids } }] },
    select: { id: true },
  });
  const attemptIds = attempts.map((attempt) => attempt.id);

  await prisma.$transaction([
    prisma.report.deleteMany({ where: { attemptId: { in: attemptIds } } }),
    prisma.attempt.deleteMany({ where: { id: { in: attemptIds } } }), // cascades questions, answers, incidents
    prisma.enrollment.deleteMany({ where: { OR: [{ examId: { in: examIds } }, { userId: { in: ids } }] } }),
    prisma.examQuestion.deleteMany({ where: { OR: [{ examId: { in: examIds } }, { questionId: { in: questionIds } }] } }),
    prisma.exam.deleteMany({ where: { id: { in: examIds } } }), // cascades announcements
    prisma.question.deleteMany({ where: { id: { in: questionIds } } }), // cascades options
    prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: [...ids, ...examIds, ...questionIds] } }] } }),
    prisma.userPreference.deleteMany({ where: { userId: { in: ids } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
}
