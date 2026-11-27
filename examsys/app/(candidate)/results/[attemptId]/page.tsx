import { Suspense, use } from "react";
import type { Metadata } from "next";
import { CandidateResult } from "@/frontend/candidate/candidate-result";
import { Skeleton } from "@/frontend/components/ui/skeleton";

export const metadata: Metadata = { title: "Exam result" };

function ResultRoute({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  return <CandidateResult key={attemptId} attemptId={attemptId} />;
}

export default function CandidateResultPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  return (
    <Suspense fallback={
      <div className="results-page" aria-label="Loading result">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    }>
      <ResultRoute params={params} />
    </Suspense>
  );
}
