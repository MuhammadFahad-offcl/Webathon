import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEV_USER_HEADER } from "@/lib/api/auth";

/**
 * Every row a test creates is tagged so cleanup only ever touches test data:
 * users get an email ending in TEST_DOMAIN. Safe to run next to the seed data.
 */
export const TEST_DOMAIN = "@m2test.local";
const runId = Math.random().toString(36).slice(2, 8);
let counter = 0;

export const testEmail = (label: string) => `${label}-${runId}-${++counter}${TEST_DOMAIN}`;

/** Makes the next handler calls run as this user (null = logged out). */
export function actAs(userId: string | null) {
  globalThis.__testHeaders = userId ? { [DEV_USER_HEADER]: userId } : {};
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
  const init: RequestInit = { method: options.method ?? "GET" };
  if (options.body !== undefined) {
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    init.headers = { "content-type": "application/json" };
  }
  const request = new Request(`http://test.local${options.path ?? "/"}`, init);
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  const text = await response.text();
  if (response.status >= 500) console.error(`[call] ${init.method} ${options.path ?? "/"} -> ${response.status} ${text}`);
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** Deletes everything this test run created (and older leftovers from crashed runs). */
export async function cleanupTestData() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: TEST_DOMAIN } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { entity: "User", entityId: { in: ids } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
