import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { listSubmissions } from "@/lib/server/grading";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/exams/:id/submissions  (exam owner or ADMIN; real attempts only)
 * Lazily finalizes attempts past their grace window first.
 * -> { exam: { id, title, resultsPublishedAt },
 *      items: [{ attemptId, candidate: { id, name, email, rollNo }, status, startedAt, submittedAt,
 *                score, totalMarks, pendingWritten, lateSyncCount, incidentCount }],
 *      summary: { total, inProgress, submitted, graded, pendingWritten } }
 */
export const GET = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  return NextResponse.json(await listSubmissions(id, session));
});
