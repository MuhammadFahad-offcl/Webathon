import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { apiHandler } from "@/lib/errors";
import { assertAttempt, finalizeAttempt } from "@/lib/services/attempt-service";
export const POST = apiHandler(async request => {
  const session = await requireRole(request, Role.CANDIDATE, Role.EXAMINER);
  const id = new URL(request.url).pathname.split("/")[3];
  await assertAttempt(id, session.userId);
  const attempt = await finalizeAttempt(id);
  return NextResponse.json({ status: attempt.status, submittedAt: attempt.submittedAt });
});
