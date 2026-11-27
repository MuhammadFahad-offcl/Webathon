import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { gradingQueue } from "@/lib/server/grading";
import { queueQuerySchema } from "@/lib/validation/grading";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/exams/:id/grading/queue?questionId=&candidateId=&page=&pageSize=  (exam owner or ADMIN)
 * Ungraded WRITTEN answers of finalized real attempts.
 * -> { items: [{ answerId, attemptId, candidate, question: { attemptQuestionId, questionId, order, text, topic, marks },
 *                response: { text }, feedback, submittedAt }],
 *      page, pageSize, total, progress: { graded, total }, filters: { questions, candidates }, resultsPublishedAt }
 */
export const GET = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  const query = queueQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return NextResponse.json(await gradingQueue(id, query, session));
});
