import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { readJson, withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { gradeAnswer } from "@/lib/server/grading";
import { gradeSchema } from "@/lib/validation/grading";

type Context = { params: Promise<{ id: string }> };

/**
 * PATCH /api/answers/:id/grade  (exam owner or ADMIN)
 * Body: { awardedMarks: number, feedback?: string | null }
 * -> { answer: { id, awardedMarks, feedback, gradedAt }, attempt: { id, status, score } }
 * 400 (fields.awardedMarks) outside 0..marks; 409 for objective / sandbox / in-progress answers
 * and once the exam's results are published. Re-scores the attempt (GRADED when nothing is pending).
 */
export const PATCH = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  const input = gradeSchema.parse(await readJson(request, { maxBytes: 16 * 1024 }));
  return NextResponse.json(await gradeAnswer(id, input, session));
});
