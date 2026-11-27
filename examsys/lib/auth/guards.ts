import { Role } from "@prisma/client";
import { cookies } from "next/headers";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

function cookieFromHeader(header: string | null) {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
}

export async function getSession(request?: Request) {
  const token = request ? cookieFromHeader(request.headers.get("cookie")) : (await cookies()).get(SESSION_COOKIE)?.value;
  const decoded = await verifySession(token);
  if (!decoded) return null;
  const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true, role: true, active: true } });
  if (!user?.active) return null;
  return { userId: user.id, role: user.role };
}

export async function requireRole(requestOrRole: Request | Role, ...remainingRoles: Role[]) {
  const request = requestOrRole instanceof Request ? requestOrRole : undefined;
  const roles = request ? remainingRoles : [requestOrRole, ...remainingRoles];
  const session = await getSession(request);
  if (!session) throw new AppError("UNAUTHENTICATED", 401, "Please sign in to continue");
  if (!roles.includes(session.role)) throw new AppError("FORBIDDEN", 403, "You do not have permission to perform this action");
  return session;
}

export async function assertExamOwner(examId: string, userId: string, role: Role) {
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam || (role !== Role.ADMIN && exam.createdById !== userId)) throw new AppError("NOT_FOUND", 404, "Exam not found");
  return exam;
}

export async function assertEnrolled(examId: string, userId: string) {
  const enrollment = await prisma.enrollment.findUnique({ where: { examId_userId: { examId, userId } } });
  if (!enrollment) throw new AppError("NOT_ENROLLED", 403, "You are not enrolled in this exam");
  return enrollment;
}
