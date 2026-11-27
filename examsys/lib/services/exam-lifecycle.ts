import { ExamStatus } from "@prisma/client";

export type ExamPhase = ExamStatus | "UPCOMING" | "ONGOING" | "COMPLETED";
export type CandidateAccessStatus = "UPCOMING" | "OPEN" | "IN_PROGRESS" | "SUBMITTED" | "RESULT_PUBLISHED" | "MISSED";

export function deriveExamPhase(exam: { status: ExamStatus; startAt: Date; endAt: Date }, now = new Date()): ExamPhase {
  if (exam.status === ExamStatus.DRAFT || exam.status === ExamStatus.ARCHIVED) return exam.status;
  if (now < exam.startAt) return "UPCOMING";
  if (now <= exam.endAt) return "ONGOING";
  return "COMPLETED";
}

export function candidateAccessStatus({ phase, hasInProgressAttempt, hasFinishedAttempt, resultsPublished }: {
  phase: ExamPhase;
  hasInProgressAttempt: boolean;
  hasFinishedAttempt: boolean;
  resultsPublished: boolean;
}): CandidateAccessStatus {
  if (hasInProgressAttempt) return "IN_PROGRESS";
  if (hasFinishedAttempt) return resultsPublished ? "RESULT_PUBLISHED" : "SUBMITTED";
  if (phase === "UPCOMING") return "UPCOMING";
  if (phase === "ONGOING") return "OPEN";
  return "MISSED";
}
