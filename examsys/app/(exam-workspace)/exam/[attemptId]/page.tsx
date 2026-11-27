import { Suspense, use } from "react";
import type { Metadata } from "next";
import { ExamWorkspace } from "@/frontend/workspace/exam-workspace";
import { Skeleton } from "@/frontend/components/ui/skeleton";

export const metadata: Metadata = { title: "Exam workspace" };

function WorkspaceRoute({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  return <ExamWorkspace attemptId={attemptId} />;
}

export default function ExamWorkspacePage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  return (
    <Suspense fallback={
      <main className="workspace-loading" role="status" aria-label="Loading exam">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-72 w-full" />
      </main>
    }>
      <WorkspaceRoute params={params} />
    </Suspense>
  );
}
