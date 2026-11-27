/**
 * TEMPORARY auth bridge for Member 2's routes until Member 1's `lib/auth` lands.
 *
 * Every M2 route imports `requireRole` from HERE, so switching to the real
 * implementation is a one-line change:
 *     export { requireRole, getSession } from "@/lib/auth";
 *
 * Until then the session comes from the `x-dev-user-id` request header (tests) or
 * the `m2_dev_user` cookie (trying the UI in a browser), and only when
 * `M2_DEV_AUTH=1` is set. Without that variable every call is rejected with 401,
 * so this can never open a hole in a deployment.
 */
import type { Role } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ApiError } from "./errors";

export type Session = { userId: string; role: Role };

export const DEV_USER_HEADER = "x-dev-user-id";
export const DEV_USER_COOKIE = "m2_dev_user";

export async function getSession(): Promise<Session | null> {
  if (process.env.M2_DEV_AUTH !== "1") return null;
  const userId =
    (await headers()).get(DEV_USER_HEADER) ?? (await cookies()).get(DEV_USER_COOKIE)?.value;
  if (!userId) return null;
  // Re-read role and active flag on every request (contract section 4).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true },
  });
  if (!user?.active) return null;
  return { userId: user.id, role: user.role };
}

export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiError("UNAUTHENTICATED", "Please log in");
  if (!roles.includes(session.role)) {
    throw new ApiError("FORBIDDEN", "You do not have permission to do this");
  }
  return session;
}
