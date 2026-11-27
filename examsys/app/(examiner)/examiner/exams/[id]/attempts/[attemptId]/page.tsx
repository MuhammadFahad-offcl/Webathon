import type { Metadata } from "next";
import { Suspense } from "react";
import { AttemptReview } from "@/components/examiner/grading/attempt-review";

export const metadata: Metadata = { title: "Attempt review · Examiner" };

export default function AttemptReviewPage() {
  return (
    <Suspense fallback={<p className="px-4 py-10 text-center text-sm opacity-60">Loading attempt…</p>}>
      <AttemptReview />
    </Suspense>
  );
}
