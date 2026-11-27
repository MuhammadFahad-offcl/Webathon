import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { readJson, withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { createAnnouncement, listAnnouncements } from "@/lib/server/monitor";
import { announcementSchema, announcementsQuerySchema } from "@/lib/validation/monitor";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/exams/:id/announcements?since=<ISO>  (exam owner, ADMIN, or an enrolled CANDIDATE)
 * -> { items: [{ id, message, at }] } oldest first (newest last); `since` keeps only `at > since`.
 * A candidate who is not enrolled gets 403 NOT_ENROLLED.
 */
export const GET = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN, Role.CANDIDATE);
  const { id } = await context.params;
  const { since } = announcementsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return NextResponse.json(await listAnnouncements(id, since, session), { headers: { "cache-control": "no-store" } });
});

/**
 * POST /api/exams/:id/announcements  (exam owner or ADMIN)
 * Body: { message } (1-500 chars) -> 201 { announcement: { id, message, at } }.
 * 409 unless the exam is published and not over (UPCOMING / ONGOING, results not published).
 */
export const POST = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  const input = announcementSchema.parse(await readJson(request, { maxBytes: 16 * 1024 }));
  return NextResponse.json(await createAnnouncement(id, input, session), { status: 201 });
});
