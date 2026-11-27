import { Suspense } from "react";
import type { Metadata } from "next";
import { ExamInstructions } from "@/frontend/candidate/exam-instructions";

export const metadata: Metadata = { title: "Exam instructions" };

export default function ExamInstructionsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted" role="status">Loading exam instructions…</div>}>
      <ExamInstructions />
    </Suspense>
  );
}
