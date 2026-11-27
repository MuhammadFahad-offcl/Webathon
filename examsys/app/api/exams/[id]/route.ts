import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { readJson, withErrors } from "@/lib/api/errors";
import { getExam, updateExam } from "@/lib/server/exams";
import { updateExamSchema } from "@/lib/validation/exams";

type Context = { params: Promise<{ id: string }> };

/** GET /api/exams/:id -> { exam } (another examiner's exam -> 404) */
export const GET = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  return NextResponse.json({ exam: await getExam(id, session) });
});

/**
 * PATCH /api/exams/:id - any subset of the creation fields. Once the exam is locked
 * (real attempts, ongoing/ended, or results published) only title/instructions -> else 409.
 */
export const PATCH = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  const input = updateExamSchema.parse(await readJson(request));
  return NextResponse.json({ exam: await updateExam(id, input, session) });
});
