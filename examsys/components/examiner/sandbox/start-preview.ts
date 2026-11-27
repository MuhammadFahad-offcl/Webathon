import { ApiClientError, apiFetch } from "@/lib/client/api";

/** Where a sandbox attempt is taken. */
export const sandboxHref = (examId: string, attemptId: string) => `/examiner/exams/${examId}/sandbox/${attemptId}`;

/**
 * Starts a fresh sandbox ("Preview as candidate") attempt through Member 1's
 * POST /api/exams/:id/attempts { sandbox: true }. Member 1 decides who may: only the
 * EXAMINER who created the exam, and the exam needs at least one question.
 */
export async function startPreview(examId: string): Promise<string> {
  const { attemptId } = await apiFetch<{ attemptId: string; resumed: boolean }>(`/api/exams/${examId}/attempts`, {
    method: "POST",
    body: JSON.stringify({ sandbox: true }),
  });
  return attemptId;
}

/** A readable reason for a failed preview start. */
export function previewErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "Could not start the preview. Please try again.";
  if (error.status === 403) return "Only the examiner who created this exam can preview it as a candidate.";
  if (error.status === 404) return "This exam no longer exists.";
  return error.message;
}
