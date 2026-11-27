import { z } from "zod";

/** Shared by the enrollment API and the exam "Candidates" tab. */

export const ENROLL_MAX_ENTRIES = 500;
export const CANDIDATE_LOOKUP_MAX = 50;

/** GET /api/candidates?search=&examId=&limit= */
export const candidatesQuerySchema = z.object({
  search: z.string().trim().max(100).optional().default(""),
  examId: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(CANDIDATE_LOOKUP_MAX).default(20),
});
export type CandidatesQuery = z.output<typeof candidatesQuerySchema>;

const entry = z.string().trim().min(1, "Empty value").max(254);

/** POST /api/exams/:id/enrollments - user ids and/or emails (matched case-insensitively). */
export const enrollSchema = z
  .object({
    userIds: z.array(entry).optional().default([]),
    emails: z.array(entry.toLowerCase()).optional().default([]),
  })
  .refine((value) => value.userIds.length + value.emails.length > 0, {
    message: "Choose at least one candidate or enter an email",
    path: ["userIds"],
  })
  .refine((value) => value.userIds.length + value.emails.length <= ENROLL_MAX_ENTRIES, {
    message: `At most ${ENROLL_MAX_ENTRIES} candidates per request`,
    path: ["userIds"],
  });
export type EnrollInput = z.input<typeof enrollSchema>;

/** Splits a pasted list ("a@x.com, b@y.com\nc@z.com") into unique trimmed entries. */
export function parseEmailList(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const value = part.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

/** The only fields the candidate lookup returns (examiners must not see more). */
export type CandidateLookupItem = {
  id: string;
  name: string;
  email: string;
  rollNo: string | null;
  /** Present only when the lookup was made with `examId`. */
  enrolled?: boolean;
};

export type EnrollmentStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED";

export type EnrollmentItem = {
  userId: string;
  name: string;
  email: string;
  rollNo: string | null;
  enrolledAt: string;
  status: EnrollmentStatus;
  attemptId: string | null;
  score: number | null;
};

export type EnrollmentCounts = { enrolled: number; notStarted: number; inProgress: number; submitted: number };

export type EnrollmentsResponse = { items: EnrollmentItem[]; counts: EnrollmentCounts };

export type EnrollResult = {
  added: number;
  alreadyEnrolled: number;
  rejected: { value: string; reason: string }[];
};
