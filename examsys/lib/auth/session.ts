import { Role } from "@prisma/client";
import { SignJWT, jwtVerify } from "jose";
import { SESSION_TTL_HOURS } from "@/lib/constants";

export const SESSION_COOKIE = "examsys_session";
type SessionPayload = { userId: string; role: Role };

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(value);
}

export async function signSession({ userId, role }: SessionPayload) {
  return new SignJWT({ role }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(`${SESSION_TTL_HOURS}h`).sign(secret());
}

export async function verifySession(token?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || !Object.values(Role).includes(payload.role as Role)) return null;
    return { userId: payload.sub, role: payload.role as Role };
  } catch { return null; }
}

export const sessionCookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const,
  path: "/", maxAge: SESSION_TTL_HOURS * 60 * 60,
};
