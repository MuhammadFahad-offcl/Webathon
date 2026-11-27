"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Button } from "@/frontend/components/ui/button";
import { previewErrorMessage, sandboxHref, startPreview } from "./start-preview";
// The workspace comes from this one module, so swapping in Member 3's is a one-line change there.
import { ExamWorkspace } from "./workspace";

/** /examiner/exams/[id]/sandbox/[attemptId]: the workspace, then a "preview submitted" panel. */
export function SandboxView() {
  const { id: examId, attemptId } = useParams<{ id: string; attemptId: string }>();
  const [closed, setClosed] = useState<{ attemptId: string; status: string } | null>(null);
  const onSubmitted = useCallback((status: string) => setClosed({ attemptId, status }), [attemptId]);

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/examiner/exams/${examId}`} className="text-sm underline">
        ← Back to the exam
      </Link>
      {closed?.attemptId === attemptId ? (
        <PreviewSubmitted examId={examId} attemptId={attemptId} status={closed.status} />
      ) : (
        <ExamWorkspace key={attemptId} attemptId={attemptId} onSubmitted={onSubmitted} />
      )}
    </div>
  );
}

function PreviewSubmitted({ examId, attemptId, status }: Readonly<{ examId: string; attemptId: string; status: string }>) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function again() {
    setStarting(true);
    setError(null);
    try {
      router.push(sandboxHref(examId, await startPreview(examId)));
    } catch (err) {
      setError(previewErrorMessage(err));
      setStarting(false);
    }
  }

  return (
    <section className="page-surface grid gap-4 p-6" aria-labelledby="preview-submitted-title">
      <h1 id="preview-submitted-title" className="text-xl font-bold">
        Preview submitted
      </h1>
      <p className="text-sm">
        {status === "GRADED"
          ? "Every answer was marked automatically, exactly as it would be for a candidate."
          : "Objective answers were marked automatically; written answers would now wait for manual grading."}{" "}
        This attempt was not recorded: it doesn&apos;t appear in any count, result or report.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void again()} disabled={starting}>
          {starting ? "Starting…" : "Start another preview"}
        </Button>
        <Link href={`/examiner/exams/${examId}/attempts/${attemptId}`} className="button-secondary">
          See how it was marked
        </Link>
        <Link href={`/examiner/exams/${examId}`} className="button-secondary">
          Back to the exam
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </section>
  );
}
