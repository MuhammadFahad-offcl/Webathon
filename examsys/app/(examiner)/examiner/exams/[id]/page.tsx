import type { Metadata } from "next";
import { Suspense } from "react";
import { ExamDetailView } from "@/components/examiner/exams/exam-detail";

export const metadata: Metadata = { title: "Exam · Examiner" };

// The client view reads the id and `?tab=` from the URL, so it needs a Suspense boundary.
export default function ExamPage() {
  return (
    <Suspense fallback={<p className="px-4 py-10 text-center text-sm opacity-60">Loading exam…</p>}>
      <ExamDetailView />
    </Suspense>
  );
}
