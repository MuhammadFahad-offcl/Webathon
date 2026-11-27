import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { getMonitor } from "@/lib/server/monitor";
import { monitorQuerySchema } from "@/lib/validation/monitor";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/exams/:id/monitor?type=&attemptId=  (exam owner or ADMIN)
 * -> { serverNow, phase, counts: { enrolled, notStarted, inProgress, submitted },
 *      attempts: [{ attemptId, candidate: { id, name }, status, answered, total, lastHeartbeatAt,
 *                   incidentCount, lateSyncCount, startedAt, expiresAt, submittedAt }],
 *      recentIncidents: [{ id, attemptId, candidateName, type, at, meta }] }
 * Real attempts only; overdue attempts are finalized first. `type` / `attemptId`
 * only filter `recentIncidents` (50 newest, or 200 for one attempt).
 */
export const GET = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  const query = monitorQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return NextResponse.json(await getMonitor(id, query, session), { headers: { "cache-control": "no-store" } });
});
