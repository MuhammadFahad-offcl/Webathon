import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { apiHandler, AppError } from "@/lib/errors";
import { loadAttempt } from "@/lib/services/attempt-service";

export const GET = apiHandler(async (request) => {
  const id = new URL(request.url).pathname.split("/")[3];
  if (!id) throw new AppError("VALIDATION_ERROR", 400, "Attempt id is required");
  const session = await requireRole(request, Role.CANDIDATE, Role.EXAMINER);
  return NextResponse.json(await loadAttempt(id, session.userId));
});
