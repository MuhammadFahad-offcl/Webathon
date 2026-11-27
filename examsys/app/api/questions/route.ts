import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { readJson, withErrors } from "@/lib/api/errors";
import { createQuestion, listQuestions } from "@/lib/server/questions";
import { listQuestionsQuerySchema, questionInputSchema } from "@/lib/validation/questions";

/**
 * GET /api/questions?search=&topic=&difficulty=&type=&page=&pageSize=  (EXAMINER own, ADMIN all)
 * -> { items: QuestionDto[], page, pageSize, total, totalPages }, newest first.
 */
export const GET = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = listQuestionsQuerySchema.parse(params);
  return NextResponse.json(await listQuestions(query, session));
});

/** POST /api/questions -> 201 { question } */
export const POST = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const input = questionInputSchema.parse(await readJson(request));
  const question = await createQuestion(input, session.userId);
  return NextResponse.json({ question }, { status: 201 });
});
