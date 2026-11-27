import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { apiHandler, AppError } from "@/lib/errors";
import { saveAnswers } from "@/lib/services/attempt-service";
import { saveSchema } from "@/lib/validation/attempt";
export const PUT = apiHandler(async request => {
  const session = await requireRole(request, Role.CANDIDATE, Role.EXAMINER);
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", 400, "Invalid autosave request");
  return NextResponse.json(await saveAnswers(new URL(request.url).pathname.split("/")[3], session.userId, parsed.data.items));
});
