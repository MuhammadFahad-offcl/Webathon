import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { withErrors } from "@/lib/api/errors";
import { publishExam } from "@/lib/server/exams";

/**
 * POST /api/exams/:id/publish -> { exam, warnings }
 * 409 CONFLICT with details.blockers when the review-before-publish check fails
 * (including a second publish of the same exam).
 */
export const POST = withErrors(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  return NextResponse.json(await publishExam(id, session));
});
