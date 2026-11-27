import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { withErrors } from "@/lib/api/errors";
import { listTopics } from "@/lib/server/questions";

/** GET /api/questions/topics -> { topics: string[] } distinct topics the caller can see, sorted. */
export const GET = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  return NextResponse.json({ topics: await listTopics(session) });
});
