import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { getAttemptReview } from "@/lib/server/grading";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/attempts/:id/review  (examiner view WITH answer keys; Member 2)
 * The exam owner or an ADMIN; sandbox attempts only for the exam's own examiner
 * (flagged `attempt.isSandbox`). Anyone else -> 404.
 * -> { exam, attempt: { id, status, isSandbox, score, totalMarks, startedAt, submittedAt, lateSyncCount, candidate },
 *      questions: [{ attemptQuestionId, questionId, order, type, topic, text, marks, negativeMarks, multiScheme,
 *                    options: [{ id, text, isCorrect }], answer: { id, response, flagged, awardedMarks, feedback, gradedAt } | null }],
 *      incidents: [{ type, at, meta }] }
 */
export const GET = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  return NextResponse.json(await getAttemptReview(id, session));
});
