import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { apiHandler, AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/errors";
import { startOrResumeAttempt } from "@/lib/services/attempt-service";
import { startSchema } from "@/lib/validation/attempt";

export const POST = apiHandler(async (request) => {
  const session = await requireRole(request, Role.CANDIDATE, Role.EXAMINER);
  const id = new URL(request.url).pathname.split("/")[3];
  if (!id) throw new AppError("VALIDATION_ERROR", 400, "Exam id is required");
  const body = startSchema.safeParse(await readJson(request, { maxBytes: 4 * 1024, emptyBody: {} }));
  if (!body.success) throw new AppError("VALIDATION_ERROR", 400, "Invalid start request");
  if (body.data.sandbox && session.role !== Role.EXAMINER) throw new AppError("FORBIDDEN", 403, "Only examiners can start a sandbox");
  const result = await startOrResumeAttempt(id, session.userId, session.role, body.data.sandbox === true);
  return NextResponse.json(result, { status: result.resumed ? 200 : 201 });
});
