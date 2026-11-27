"use client";

import { Card } from "./ui";

/**
 * Candidates tab of /examiner/exams/[id]. Placeholder: the enrollment PR replaces this
 * component's body (keep the export name and props).
 */
export function CandidatesTabSlot({ examId }: { examId: string }) {
  return (
    <Card title="Candidates">
      <p className="text-sm opacity-70" data-exam-id={examId}>
        Candidate enrollment is coming in a later PR.
      </p>
    </Card>
  );
}
