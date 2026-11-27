"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/frontend/components/ui/button";
import { previewErrorMessage, sandboxHref, startPreview } from "./start-preview";

/**
 * Exam header action: take the exam exactly as a candidate would, in a sandbox attempt that
 * is never recorded. The server decides who may (the exam's own examiner); its refusal is shown.
 */
export function PreviewAsCandidateButton({ examId, questionCount }: Readonly<{ examId: string; questionCount: number }>) {
  const router = useRouter();
  const hintId = useId();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noQuestions = questionCount === 0;

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const attemptId = await startPreview(examId);
      router.push(sandboxHref(examId, attemptId));
    } catch (err) {
      setError(previewErrorMessage(err));
      setStarting(false);
    }
  }

  return (
    <div className="flex max-w-xs flex-col items-end gap-1 text-right">
      <Button
        variant="secondary"
        onClick={() => void start()}
        disabled={noQuestions || starting}
        aria-describedby={noQuestions || error ? hintId : undefined}
      >
        {starting ? "Starting preview…" : "Preview as candidate"}
      </Button>
      {noQuestions ? (
        <p id={hintId} className="text-xs text-muted">
          Add at least one question to preview this exam.
        </p>
      ) : (
        error && (
          <p id={hintId} role="alert" className="text-xs text-[var(--danger)]">
            {error}
          </p>
        )
      )}
    </div>
  );
}
