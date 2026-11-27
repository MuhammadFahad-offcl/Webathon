import { AttemptStatus, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { apiHandler } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { candidateAccessStatus, deriveExamPhase } from "@/lib/services/exam-lifecycle";

export const GET = apiHandler(async (request) => {
  const session = await requireRole(request, Role.CANDIDATE);
  const now = new Date();
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: session.userId },
    include: {
      exam: {
        include: {
          attempts: {
            where: { userId: session.userId, isSandbox: false },
            select: { id: true, status: true },
          },
        },
      },
    },
    orderBy: { exam: { startAt: "asc" } },
  });

  const groups = { available: [] as object[], upcoming: [] as object[], completed: [] as object[] };
  for (const { exam } of enrollments) {
    if (exam.status !== "PUBLISHED") continue;
    const phase = deriveExamPhase(exam, now);
    const attempt = exam.attempts[0];
    const status = candidateAccessStatus({
      phase,
      hasInProgressAttempt: attempt?.status === AttemptStatus.IN_PROGRESS,
      hasFinishedAttempt: attempt?.status === AttemptStatus.SUBMITTED || attempt?.status === AttemptStatus.GRADED,
      resultsPublished: exam.resultsPublishedAt !== null,
    });
    const item = {
      examId: exam.id, title: exam.title, instructions: exam.instructions, startAt: exam.startAt,
      endAt: exam.endAt, durationMin: exam.durationMin, totalMarks: exam.totalMarks, phase,
      accessStatus: status, attemptId: status === "IN_PROGRESS" ? attempt?.id ?? null : null,
      resultsPublished: exam.resultsPublishedAt !== null,
    };
    if (status === "OPEN" || status === "IN_PROGRESS") groups.available.push(item);
    else if (status === "UPCOMING") groups.upcoming.push(item);
    else groups.completed.push(item);
  }
  return NextResponse.json(groups);
});
