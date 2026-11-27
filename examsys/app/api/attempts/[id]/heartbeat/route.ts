import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { apiHandler, AppError } from "@/lib/errors";
import { heartbeat } from "@/lib/services/attempt-service";
import { heartbeatSchema } from "@/lib/validation/attempt";
export const POST = apiHandler(async request => {
  const session = await requireRole(request, Role.CANDIDATE, Role.EXAMINER);
  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", 400, "Invalid heartbeat");
  return NextResponse.json(await heartbeat(new URL(request.url).pathname.split("/")[3], session.userId, parsed.data.sinceAnnouncementAt ? new Date(parsed.data.sinceAnnouncementAt) : undefined));
});
