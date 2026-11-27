import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { apiHandler } from "@/lib/errors";
import { candidateResult } from "@/lib/services/result-service";
export const GET = apiHandler(async request => {
  const session = await requireRole(request, Role.CANDIDATE);
  const id = new URL(request.url).pathname.split("/")[4];
  return NextResponse.json(await candidateResult(id, session.userId));
});
