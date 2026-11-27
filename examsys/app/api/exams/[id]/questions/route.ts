import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { readJson, withErrors } from "@/lib/api/errors";
import { assignQuestions } from "@/lib/server/exams";
import { assignQuestionsSchema } from "@/lib/validation/exams";

/**
 * PUT /api/exams/:id/questions  body { items: [{ questionId, marks, order }] }
 * Replaces the whole assignment and recomputes totalMarks -> { exam }. 409 once locked.
 */
export const PUT = withErrors(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  const input = assignQuestionsSchema.parse(await readJson(request));
  return NextResponse.json({ exam: await assignQuestions(id, input, session) });
});
