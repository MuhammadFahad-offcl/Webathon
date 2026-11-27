import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { readJson, withErrors } from "@/lib/api/errors";
import { deleteQuestion, getQuestion, updateQuestion } from "@/lib/server/questions";
import { updateQuestionSchema } from "@/lib/validation/questions";

type Context = { params: Promise<{ id: string }> };

/** GET /api/questions/:id -> { question: QuestionDto & { exams: [{ id, title, status }] } } */
export const GET = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  return NextResponse.json({ question: await getQuestion(id, session) });
});

/**
 * PATCH /api/questions/:id - any subset of the creation fields; `options` replaces the list.
 * 409 when changing type/options/marks of a question used in a published exam.
 */
export const PATCH = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  const input = updateQuestionSchema.parse(await readJson(request));
  return NextResponse.json({ question: await updateQuestion(id, input, session) });
});

/** DELETE /api/questions/:id -> 204; 409 with details.exams when any exam uses it. */
export const DELETE = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  await deleteQuestion(id, session);
  return new Response(null, { status: 204 });
});
