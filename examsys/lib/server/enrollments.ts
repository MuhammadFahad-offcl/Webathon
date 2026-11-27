import { AttemptStatus, Prisma, Role } from "@prisma/client";
import type { z } from "zod";
import { conflict, notFound } from "@/lib/api/errors";
import { assertExamOwner } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { REAL_ATTEMPT } from "@/lib/server/attempt-scope";
import { deriveExamPhase } from "@/lib/services/exam-lifecycle";
import type {
  CandidateLookupItem,
  CandidatesQuery,
  EnrollResult,
  EnrollmentCounts,
  EnrollmentItem,
  EnrollmentsResponse,
  enrollSchema,
} from "@/lib/validation/enrollments";

type Session = { userId: string; role: Role };

/** The only user fields the candidate lookup and enrollment list ever read. */
const candidateSelect = { id: true, name: true, email: true, rollNo: true } satisfies Prisma.UserSelect;

/**
 * Minimal candidate lookup for enrolling people: ACTIVE users with role CANDIDATE only.
 * With `examId` (which the caller must own), each item says whether it is already enrolled.
 */
export async function searchCandidates(query: CandidatesQuery, session: Session) {
  if (query.examId) await assertExamOwner(query.examId, session.userId, session.role);

  const where: Prisma.UserWhereInput = { role: Role.CANDIDATE, active: true };
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
      { rollNo: { contains: query.search, mode: "insensitive" } },
    ];
  }
  const users = await prisma.user.findMany({
    where,
    select: candidateSelect,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: query.limit,
  });

  let enrolled: Set<string> | null = null;
  if (query.examId) {
    const rows = await prisma.enrollment.findMany({
      where: { examId: query.examId, userId: { in: users.map((user) => user.id) } },
      select: { userId: true },
    });
    enrolled = new Set(rows.map((row) => row.userId));
  }

  const items: CandidateLookupItem[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    rollNo: user.rollNo,
    ...(enrolled ? { enrolled: enrolled.has(user.id) } : {}),
  }));
  return { items };
}

/** Enrolled candidates with the status of their real (non-sandbox) attempt. */
export async function listEnrollments(examId: string, session: Session): Promise<EnrollmentsResponse> {
  await assertExamOwner(examId, session.userId, session.role);

  const [enrollments, attempts] = await Promise.all([
    prisma.enrollment.findMany({
      where: { examId },
      select: { createdAt: true, user: { select: candidateSelect } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.attempt.findMany({
      where: { examId, ...REAL_ATTEMPT },
      select: { id: true, userId: true, status: true, score: true },
    }),
  ]);
  const attemptByUser = new Map(attempts.map((attempt) => [attempt.userId, attempt]));

  const counts: EnrollmentCounts = { enrolled: 0, notStarted: 0, inProgress: 0, submitted: 0 };
  const items: EnrollmentItem[] = enrollments.map(({ createdAt, user }) => {
    const attempt = attemptByUser.get(user.id);
    const status = attempt?.status ?? "NOT_STARTED";
    counts.enrolled += 1;
    if (status === "NOT_STARTED") counts.notStarted += 1;
    else if (status === AttemptStatus.IN_PROGRESS) counts.inProgress += 1;
    else counts.submitted += 1; // SUBMITTED or GRADED
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      rollNo: user.rollNo,
      enrolledAt: createdAt.toISOString(),
      status,
      attemptId: attempt?.id ?? null,
      score: attempt?.score ?? null,
    };
  });
  return { items, counts };
}

/**
 * Enrolls candidates by id and/or email. Unknown, inactive and non-candidate users are
 * reported in `rejected`; duplicates (in the request or already enrolled) are skipped.
 */
export async function addEnrollments(
  examId: string,
  input: z.output<typeof enrollSchema>,
  session: Session,
): Promise<EnrollResult> {
  const exam = await assertExamOwner(examId, session.userId, session.role);
  const phase = deriveExamPhase(exam, new Date());
  if (exam.resultsPublishedAt) throw conflict("Results are already published; enrollment is closed");
  if (phase === "COMPLETED") throw conflict("This exam has ended; enrollment is closed");
  if (phase === "ARCHIVED") throw conflict("This exam is archived; enrollment is closed");

  const ids = [...new Set(input.userIds)];
  const emails = [...new Set(input.emails.map((email) => email.toLowerCase()))];
  const users = await prisma.user.findMany({
    where: {
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(emails.length ? [{ email: { in: emails, mode: "insensitive" as const } }] : []),
      ],
    },
    select: { id: true, email: true, role: true, active: true },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));

  const rejected: EnrollResult["rejected"] = [];
  const accepted = new Set<string>();
  const check = (value: string, user: (typeof users)[number] | undefined, missing: string) => {
    if (!user) rejected.push({ value, reason: missing });
    else if (user.role !== Role.CANDIDATE) rejected.push({ value, reason: "Only candidates can be enrolled" });
    else if (!user.active) rejected.push({ value, reason: "This account is inactive" });
    else accepted.add(user.id);
  };
  for (const id of ids) check(id, byId.get(id), "No user with this id");
  for (const email of emails) check(email, byEmail.get(email), "No user with this email");

  let added = 0;
  if (accepted.size > 0) {
    const result = await prisma.enrollment.createMany({
      data: [...accepted].map((userId) => ({ examId, userId })),
      skipDuplicates: true,
    });
    added = result.count;
  }
  const outcome: EnrollResult = { added, alreadyEnrolled: accepted.size - added, rejected };

  await prisma.auditLog.create({
    data: {
      actorId: session.userId,
      action: "enrollment.add",
      entity: "Exam",
      entityId: examId,
      meta: { added: outcome.added, alreadyEnrolled: outcome.alreadyEnrolled, rejected: rejected.length },
    },
  });
  return outcome;
}

/** Removes one enrollment; refused once the candidate has a real attempt. */
export async function removeEnrollment(examId: string, userId: string, session: Session) {
  await assertExamOwner(examId, session.userId, session.role);

  const [enrollment, attempt] = await Promise.all([
    prisma.enrollment.findUnique({ where: { examId_userId: { examId, userId } }, select: { id: true } }),
    prisma.attempt.findFirst({ where: { examId, userId, ...REAL_ATTEMPT }, select: { id: true } }),
  ]);
  if (!enrollment) throw notFound("Enrollment");
  if (attempt) throw conflict("This candidate has already started; can't remove");

  await prisma.$transaction([
    prisma.enrollment.delete({ where: { id: enrollment.id } }),
    prisma.auditLog.create({
      data: {
        actorId: session.userId,
        action: "enrollment.remove",
        entity: "Exam",
        entityId: examId,
        meta: { userId },
      },
    }),
  ]);
}
