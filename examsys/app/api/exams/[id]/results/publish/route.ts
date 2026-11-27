import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { assertExamOwner, requireRole } from "@/lib/auth/guards";
import { apiHandler } from "@/lib/errors";
import { publishResults } from "@/lib/services/result-service";
export const POST = apiHandler(async request => {
  const session = await requireRole(request, Role.EXAMINER);
  const id = new URL(request.url).pathname.split("/")[3];
  await assertExamOwner(id, session.userId, session.role);
  return NextResponse.json(await publishResults(id, session.userId));
});
