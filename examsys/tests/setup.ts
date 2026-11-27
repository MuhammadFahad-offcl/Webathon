import { existsSync } from "node:fs";
import { vi } from "vitest";

// Integration tests run against the Neon TEST branch in .env.test (never the demo DB).
if (existsSync(".env.test")) process.loadEnvFile(".env.test");
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing: create examsys/.env.test (see tests/README.md)");
}
process.env.M2_DEV_AUTH = "1";

// Route handlers read the session through next/headers, which only exists inside a
// Next.js request. Tests set the current headers with `actAs()` from tests/helpers.ts.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(globalThis.__testHeaders ?? {}),
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
}));

declare global {
  var __testHeaders: Record<string, string> | undefined;
}
