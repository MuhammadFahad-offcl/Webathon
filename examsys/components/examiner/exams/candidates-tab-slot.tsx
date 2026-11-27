"use client";

import { CandidatesTab } from "@/components/examiner/enrollments/candidates-tab";

/** The exam page's "Candidates" tab (Member 2, PR 4: enrollment). */
export function CandidatesTabSlot({ examId }: Readonly<{ examId: string }>) {
  return <CandidatesTab examId={examId} />;
}
