"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { Button } from "@/frontend/components/ui/button";
import { Checkbox } from "@/frontend/components/ui/checkbox";
import { ErrorState } from "@/frontend/components/ui/error-state";
import { PageHeader } from "@/frontend/components/ui/page-header";
import { Skeleton } from "@/frontend/components/ui/skeleton";
import { formatDateTime } from "@/frontend/candidate/exam-time";
import type { CandidateExam, CandidateExamGroups } from "@/frontend/candidate/exam-types";

function findExam(groups: CandidateExamGroups, examId: string): CandidateExam | undefined {
  return [...groups.available, ...groups.upcoming, ...groups.completed]
    .find((exam) => exam.examId === examId);
}

function startErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "Could not start the exam. Please try again.";
  if (error.code === "NOT_ENROLLED") return "You are not enrolled in this exam. Contact your examiner.";
  if (error.code === "EXAM_NOT_AVAILABLE") return "This exam is not open yet.";
  if (error.code === "EXAM_ENDED") return "The exam window has ended.";
  if (error.code === "CONFLICT") return "This exam attempt is already complete.";
  return error.message;
}

export function ExamInstructions() {
  const { examId } = useParams<{ examId: string }>();
  const router = useRouter();
  const [exam, setExam] = useState<CandidateExam | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<CandidateExamGroups>("/api/candidate/exams", { signal: controller.signal })
      .then((groups) => {
        const found = findExam(groups, examId);
        if (!found) setError("This exam is not available in your enrolled exam list.");
        else setExam(found);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiClientError && cause.status === 401) {
          router.replace("/login");
          return;
        }
        setError(cause instanceof ApiClientError ? cause.message : "Could not load exam instructions.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [examId, router]);

  async function beginExam() {
    if (!exam || exam.accessStatus !== "OPEN" || !confirmed) return;
    setStarting(true);
    setError(null);
    try {
      const result = await apiFetch<{ attemptId: string }>(
        `/api/exams/${encodeURIComponent(exam.examId)}/attempts`,
        { method: "POST", body: JSON.stringify({ sandbox: false }) },
      );
      router.push(`/exam/${encodeURIComponent(result.attemptId)}`);
    } catch (cause) {
      setError(startErrorMessage(cause));
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto grid max-w-3xl gap-4 py-8" role="status" aria-label="Loading exam instructions">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        <ErrorState
          title="Exam unavailable"
          description={error ?? "This exam could not be found."}
          action={<Link className="button-secondary" href="/dashboard">Back to my exams</Link>}
        />
      </div>
    );
  }

  const resumeAttemptId = exam.accessStatus === "IN_PROGRESS" ? exam.attemptId : null;
  const isInProgress = resumeAttemptId !== null;
  const canStart = exam.accessStatus === "OPEN";

  return (
    <div className="mx-auto max-w-3xl">
      <Link className="mb-5 inline-flex text-sm font-bold text-[var(--brand)] underline underline-offset-4" href="/dashboard">
        ← Back to my exams
      </Link>
      <PageHeader
        title={exam.title}
        description={`${formatDateTime(exam.startAt)} · ${exam.durationMin} minutes · ${exam.totalMarks} marks`}
      />

      {error && (
        <p className="mb-5 rounded-lg border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <section className="page-surface grid gap-5 p-6" aria-labelledby="instructions-title">
        <div>
          <h2 id="instructions-title" className="text-lg font-bold">Exam instructions</h2>
          <p className="mt-3 whitespace-pre-wrap leading-relaxed text-muted">
            {exam.instructions || "Your examiner has not provided additional instructions."}
          </p>
        </div>
        <div className="grid gap-3 rounded-xl bg-[var(--surface-2)] p-4">
          <h3 className="font-bold">Before you begin</h3>
          <ul className="grid list-disc gap-2 pl-5 text-sm leading-relaxed">
            <li>Your timer starts when the attempt begins and does not pause if your connection drops.</li>
            <li>Reconnect as soon as possible after a connection problem and check the save status in the exam workspace.</li>
            <li>Your attempt cannot run past the exam window ending at {formatDateTime(exam.endAt)}.</li>
            <li>You can review unanswered or flagged questions before submitting, while the attempt is open.</li>
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-4">
          <h3 className="font-bold">What is recorded</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The system may record tab visibility changes, optional fullscreen exits, copy/paste actions in answer fields,
            and connection gaps. These events are indicators for human review, not proof of misconduct or automatic penalties.
            No webcam, microphone, screenshots, or keystroke logging are used.
          </p>
        </div>
        {!canStart && !isInProgress && (
          <p className="rounded-lg bg-[var(--surface-2)] px-4 py-3 text-sm font-semibold">
            {exam.accessStatus === "UPCOMING"
              ? `This exam opens at ${formatDateTime(exam.startAt)}.`
              : exam.accessStatus === "SUBMITTED"
                ? "Your attempt was submitted. Results will be available when published."
                : exam.accessStatus === "RESULT_PUBLISHED"
                  ? "Your result has been published. Open it from your exam dashboard."
                  : "This exam is no longer available."}
          </p>
        )}
        {resumeAttemptId ? (
          <Link className="button-primary justify-self-start" href={`/exam/${encodeURIComponent(resumeAttemptId)}`}>
            Resume exam
          </Link>
        ) : (
          <>
            <label className="flex items-start gap-3 text-sm leading-relaxed">
              <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>I have read these instructions and understand the exam timer, offline behavior, and privacy notice.</span>
            </label>
            <Button
              className="justify-self-start"
              type="button"
              onClick={() => void beginExam()}
              disabled={!canStart || !confirmed || starting}
            >
              {starting ? "Starting exam…" : "Start exam"}
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
