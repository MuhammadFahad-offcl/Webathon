import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { withErrors } from "@/lib/api/errors";
import { duplicateQuestion } from "@/lib/server/questions";

/** POST /api/questions/:id/duplicate -> 201 { question } (a "Copy of ..." owned by the caller) */
export const POST = withErrors(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
    const { id } = await context.params;
    const question = await duplicateQuestion(id, session);
    return NextResponse.json({ question }, { status: 201 });
  },
);
