import type { Metadata } from "next";
import { Suspense } from "react";
import { ExamReview } from "@/components/examiner/exams/exam-review";

export const metadata: Metadata = { title: "Review & publish · Examiner" };

export default function ExamReviewPage() {
  return (
    <Suspense fallback={<p className="px-4 py-10 text-center text-sm opacity-60">Loading…</p>}>
      <ExamReview />
    </Suspense>
  );
}
