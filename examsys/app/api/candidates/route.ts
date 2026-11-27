import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { searchCandidates } from "@/lib/server/enrollments";
import { candidatesQuerySchema } from "@/lib/validation/enrollments";

/**
 * GET /api/candidates?search=&examId=&limit=  (EXAMINER, ADMIN)
 * -> { items: [{ id, name, email, rollNo, enrolled? }] } - active CANDIDATE users only.
 * `enrolled` is present only with `examId` (an exam the caller owns, else 404).
 */
export const GET = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = candidatesQuerySchema.parse(params);
  return NextResponse.json(await searchCandidates(query, session));
});
