import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { apiHandler, AppError } from "@/lib/errors";
import { recordIncident } from "@/lib/services/attempt-service";
import { incidentSchema } from "@/lib/validation/attempt";
export const POST = apiHandler(async request => {
  const session = await requireRole(request, Role.CANDIDATE);
  const parsed = incidentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || JSON.stringify(parsed.data.meta ?? {}).length > 1024) throw new AppError("VALIDATION_ERROR", 400, "Invalid incident");
  const result = await recordIncident(new URL(request.url).pathname.split("/")[3], session.userId, parsed.data.type, parsed.data.meta as Record<string, string | number | boolean> | undefined);
  return NextResponse.json(result, { status: 201 });
});
