import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { readJson, withErrors } from "@/lib/api/errors";
import { createExam, listExams } from "@/lib/server/exams";
import { createExamSchema, listExamsQuerySchema } from "@/lib/validation/exams";

/** GET /api/exams?search=&phase=  (EXAMINER: own exams, ADMIN: all) -> { items } newest first */
export const GET = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const query = listExamsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return NextResponse.json(await listExams(session, query));
});

/** POST /api/exams -> 201 { exam } (status DRAFT) */
export const POST = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const input = createExamSchema.parse(await readJson(request));
  const exam = await createExam(input, session);
  return NextResponse.json({ exam }, { status: 201 });
});
