import { NextResponse } from "next/server";
import { apiHandler, AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/errors";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation/auth";
import { clearFailures, isRateLimited, loginKey, recordFailure } from "@/lib/auth/login-rate-limit";
import { signSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";

export const POST = apiHandler(async (request) => {
  const body = await readJson(request, { maxBytes: 4 * 1024 });
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", 400, "Check the highlighted fields", Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = loginKey(parsed.data.email, ip);
  if (isRateLimited(key)) throw new AppError("RATE_LIMITED", 429, "Too many failed sign-in attempts. Try again later.");
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.active || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    recordFailure(key);
    throw new AppError("UNAUTHENTICATED", 401, "Invalid email or password");
  }
  clearFailures(key);
  const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  response.cookies.set(SESSION_COOKIE, await signSession({ userId: user.id, role: user.role }), sessionCookieOptions);
  return response;
});
