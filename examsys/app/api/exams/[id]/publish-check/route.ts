import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { withErrors } from "@/lib/api/errors";
import { getPublishCheck } from "@/lib/server/exams";

/** GET /api/exams/:id/publish-check -> { ready, blockers, warnings, summary } */
export const GET = withErrors(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  return NextResponse.json(await getPublishCheck(id, session));
});
