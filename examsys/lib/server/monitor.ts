import { AttemptStatus, Prisma, Role } from "@prisma/client";
import type { z } from "zod";
import { conflict } from "@/lib/api/errors";
import { assertEnrolled, assertExamOwner } from "@/lib/auth/guards";
import { GRACE_MS } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { REAL_ATTEMPT, realAttemptSql } from "@/lib/server/attempt-scope";
import { finalizeIfExpired } from "@/lib/services/attempt-service";
import { deriveExamPhase } from "@/lib/services/exam-lifecycle";
import type { ExamPhaseName } from "@/lib/validation/exams";
import {
  MONITOR_ATTEMPT_INCIDENTS,
  MONITOR_RECENT_INCIDENTS,
  type Announcement,
  type AnnouncementsResponse,
  type IncidentTypeName,
  type MonitorAttempt,
  type MonitorQuery,
  type MonitorResponse,
  type announcementSchema,
} from "@/lib/validation/monitor";

type Session = { userId: string; role: Role };

/**
 * Live monitor for one exam (owner or ADMIN). Real attempts only. Polled every
 * MONITOR_POLL_MS, so it runs a fixed number of queries whatever the class size:
 * one sweep for overdue attempts, then four reads in parallel.
 */
export async function getMonitor(examId: string, query: MonitorQuery, session: Session): Promise<MonitorResponse> {
  const exam = await assertExamOwner(examId, session.userId, session.role);

  // Lazy finalization: attempts past expiresAt + GRACE_MS show as submitted.
  const overdue = await prisma.attempt.findMany({
    where: {
      examId,
      ...REAL_ATTEMPT,
      status: AttemptStatus.IN_PROGRESS,
      expiresAt: { lt: new Date(Date.now() - GRACE_MS) },
    },
    select: { id: true },
  });
  for (const attempt of overdue) await finalizeIfExpired(attempt.id);

  const incidentWhere: Prisma.IncidentWhereInput = {
    attempt: { examId, ...REAL_ATTEMPT },
    ...(query.type ? { type: query.type } : {}),
    ...(query.attemptId ? { attemptId: query.attemptId } : {}),
  };

  const [enrollments, attempts, answeredRows, incidents] = await Promise.all([
    prisma.enrollment.findMany({ where: { examId }, select: { userId: true } }),
    prisma.attempt.findMany({
      where: { examId, ...REAL_ATTEMPT },
      select: {
        id: true,
        status: true,
        startedAt: true,
        expiresAt: true,
        submittedAt: true,
        lastHeartbeatAt: true,
        lateSyncCount: true,
        user: { select: { id: true, name: true } },
        _count: { select: { questions: true, incidents: true } },
      },
      orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
    }),
    // "answered" = an answer whose response is non-empty (finalization stores empty rows too).
    prisma.$queryRaw<{ attemptId: string; answered: number }[]>`
      SELECT aq."attemptId" AS "attemptId", COUNT(*)::int AS "answered"
      FROM "Answer" an
      JOIN "AttemptQuestion" aq ON aq."id" = an."attemptQuestionId"
      JOIN "Attempt" a ON a."id" = aq."attemptId"
      WHERE a."examId" = ${examId} AND ${realAttemptSql("a")}
        AND (
          (jsonb_typeof(an."response"->'optionIds') = 'array' AND jsonb_array_length(an."response"->'optionIds') > 0)
          OR length(btrim(COALESCE(an."response"->>'text', ''))) > 0
        )
      GROUP BY aq."attemptId"`,
    prisma.incident.findMany({
      where: incidentWhere,
      select: { id: true, attemptId: true, type: true, at: true, meta: true, attempt: { select: { user: { select: { name: true } } } } },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: query.attemptId ? MONITOR_ATTEMPT_INCIDENTS : MONITOR_RECENT_INCIDENTS,
    }),
  ]);

  const answeredBy = new Map(answeredRows.map((row) => [row.attemptId, Number(row.answered)]));
  const enrolledIds = new Set(enrollments.map((row) => row.userId));
  const counts = { enrolled: enrolledIds.size, notStarted: enrolledIds.size, inProgress: 0, submitted: 0 };

  const items: MonitorAttempt[] = attempts.map((attempt) => {
    if (enrolledIds.has(attempt.user.id)) counts.notStarted -= 1;
    if (attempt.status === AttemptStatus.IN_PROGRESS) counts.inProgress += 1;
    else counts.submitted += 1; // SUBMITTED or GRADED
    return {
      attemptId: attempt.id,
      candidate: { id: attempt.user.id, name: attempt.user.name },
      status: attempt.status,
      answered: answeredBy.get(attempt.id) ?? 0,
      total: attempt._count.questions,
      lastHeartbeatAt: attempt.lastHeartbeatAt?.toISOString() ?? null,
      incidentCount: attempt._count.incidents,
      lateSyncCount: attempt.lateSyncCount,
      startedAt: attempt.startedAt.toISOString(),
      expiresAt: attempt.expiresAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
    };
  });

  const now = new Date();
  return {
    serverNow: now.toISOString(),
    phase: deriveExamPhase(exam, now) as ExamPhaseName,
    counts,
    attempts: items,
    recentIncidents: incidents.map((incident) => ({
      id: incident.id,
      attemptId: incident.attemptId,
      candidateName: incident.attempt.user.name,
      type: incident.type as IncidentTypeName,
      at: incident.at.toISOString(),
      meta: incident.meta ?? {},
    })),
  };
}

const announcementSelect = { id: true, message: true, at: true } satisfies Prisma.AnnouncementSelect;

const toAnnouncement = (row: { id: string; message: string; at: Date }): Announcement => ({
  id: row.id,
  message: row.message,
  at: row.at.toISOString(),
});

/**
 * Announcements of an exam, oldest first (newest last, like the heartbeat).
 * Readable by the exam owner / ADMIN and by candidates enrolled in it.
 */
export async function listAnnouncements(examId: string, since: string | undefined, session: Session): Promise<AnnouncementsResponse> {
  if (session.role === Role.CANDIDATE) await assertEnrolled(examId, session.userId);
  else await assertExamOwner(examId, session.userId, session.role);

  const rows = await prisma.announcement.findMany({
    where: { examId, ...(since ? { at: { gt: new Date(since) } } : {}) },
    select: announcementSelect,
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  return { items: rows.map(toAnnouncement) };
}

/** Posts an announcement; only while the exam is published and not yet over. */
export async function createAnnouncement(
  examId: string,
  input: z.output<typeof announcementSchema>,
  session: Session,
): Promise<{ announcement: Announcement }> {
  const exam = await assertExamOwner(examId, session.userId, session.role);
  const phase = deriveExamPhase(exam, new Date());
  if (exam.resultsPublishedAt) throw conflict("Results are already published; announcements are closed");
  if (phase === "COMPLETED") throw conflict("This exam has ended; announcements are closed");
  if (phase !== "UPCOMING" && phase !== "ONGOING") throw conflict("Publish the exam before sending announcements");

  const [row] = await prisma.$transaction([
    prisma.announcement.create({ data: { examId, message: input.message }, select: announcementSelect }),
    prisma.auditLog.create({
      data: {
        actorId: session.userId,
        action: "announcement.create",
        entity: "Exam",
        entityId: examId,
        meta: { message: input.message },
      },
    }),
  ]);
  return { announcement: toAnnouncement(row) };
}
