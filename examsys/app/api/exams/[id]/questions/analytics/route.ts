import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { assertExamOwner, requireRole } from "@/lib/auth/guards";
import { withErrors } from "@/lib/api/errors";
import { getQuestionAnalytics } from "@/lib/reports/analytics";

/** GET /api/exams/:id/questions/analytics -> { items } per-question statistics. */
export const GET = withErrors(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  await assertExamOwner(id, session.userId, session.role);
  return NextResponse.json(await getQuestionAnalytics(id));
});
