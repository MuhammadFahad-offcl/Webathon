import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { readJson, withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { addEnrollments, listEnrollments } from "@/lib/server/enrollments";
import { enrollSchema } from "@/lib/validation/enrollments";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/exams/:id/enrollments  (exam owner or ADMIN)
 * -> { items: [{ userId, name, email, rollNo, enrolledAt, status, attemptId, score }],
 *      counts: { enrolled, notStarted, inProgress, submitted } }
 */
export const GET = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  return NextResponse.json(await listEnrollments(id, session));
});

/**
 * POST /api/exams/:id/enrollments  (exam owner or ADMIN)
 * Body: { userIds?: string[], emails?: string[] } -> { added, alreadyEnrolled, rejected: [{ value, reason }] }
 * 409 once the exam has ended or its results are published.
 */
export const POST = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  const input = enrollSchema.parse(await readJson(request));
  return NextResponse.json(await addEnrollments(id, input, session));
});
