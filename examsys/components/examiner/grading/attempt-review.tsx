"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EnrollmentStatusBadge } from "@/components/examiner/enrollments/status-badge";
import { formatDateTime, formatMarks } from "@/components/examiner/exams/format";
import { Card, Fact, Notice, typeBadge } from "@/components/examiner/exams/ui";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type { ReviewQuestion, ReviewResponse } from "@/lib/validation/grading";

/**
 * /examiner/exams/[id]/attempts/[attemptId] - the examiner's review of one attempt:
 * every question with the answer key highlighted, the candidate's response and the marks.
 */
export function AttemptReview() {
  const { id: examId, attemptId } = useParams<{ id: string; attemptId: string }>();
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const requestKey = `${attemptId}#${reloadKey}`;
  const loading = settledKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    apiFetch<ReviewResponse>(`/api/attempts/${attemptId}/review`)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiClientError ? { status: err.status, message: err.message } : { status: 0, message: "Could not load the attempt" },
        );
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [attemptId, requestKey]);

  const backLink = (
    <Link href={`/examiner/exams/${examId}?tab=results`} className="text-sm text-blue-700 hover:underline dark:text-blue-300">
      ← Back to results
    </Link>
  );

  // An attempt of another exam under this URL is treated like a missing one.
  const mismatch = data && data.exam.id !== examId;
  if (!data || mismatch) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8">
        {backLink}
        {error || mismatch ? (
          <Notice tone="error" role="alert">
            {mismatch || error?.status === 404 ? "This attempt doesn't exist or you don't have access to it." : error?.message}{" "}
            {!mismatch && error?.status !== 404 && (
              <button type="button" className="underline" onClick={() => setReloadKey((key) => key + 1)}>
                Retry
              </button>
            )}
          </Notice>
        ) : (
          <p className="py-10 text-center text-sm opacity-60" aria-busy={loading}>
            Loading attempt…
          </p>
        )}
      </div>
    );
  }

  const { attempt, questions, incidents } = data;
  const pending = questions.filter((q) => q.answer?.awardedMarks == null).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      {backLink}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{attempt.candidate.name}</h1>
          <EnrollmentStatusBadge status={attempt.status} />
          {attempt.isSandbox && (
            <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-semibold text-fuchsia-900 dark:bg-fuchsia-950 dark:text-fuchsia-200">
              SANDBOX · not recorded
            </span>
          )}
        </div>
        <p className="text-sm opacity-70">
          {data.exam.title} · {attempt.candidate.email}
          {attempt.candidate.rollNo ? ` · ${attempt.candidate.rollNo}` : ""}
        </p>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact
            label="Score"
            value={attempt.score === null ? "—" : `${formatMarks(attempt.score)} / ${formatMarks(attempt.totalMarks)}`}
          />
          <Fact label="Started" value={formatDateTime(attempt.startedAt)} />
          <Fact label="Submitted" value={attempt.submittedAt ? formatDateTime(attempt.submittedAt) : "—"} />
          <Fact label="Late syncs" value={attempt.lateSyncCount} />
        </dl>
      </header>

      {attempt.status === "IN_PROGRESS" && (
        <Notice tone="info">This attempt is still in progress; marks appear once it is submitted or time runs out.</Notice>
      )}
      {attempt.status === "SUBMITTED" && pending > 0 && !attempt.isSandbox && (
        <Notice tone="warning">
          {pending} written answer{pending === 1 ? " is" : "s are"} waiting for marks; the score is provisional.{" "}
          {!data.exam.resultsPublishedAt && (
            <Link href={`/examiner/exams/${examId}?tab=grading`} className="underline">
              Open the grading queue
            </Link>
          )}
        </Notice>
      )}

      <ol className="flex flex-col gap-4">
        {questions.map((question) => (
          <li key={question.attemptQuestionId}>
            <QuestionCard question={question} finalized={attempt.status !== "IN_PROGRESS"} />
          </li>
        ))}
      </ol>

      <Card title="Integrity indicators">
        <p className="mb-3 text-xs opacity-70">Incidents are indicators for review, not proof of misconduct.</p>
        {incidents.length === 0 ? (
          <p className="text-sm opacity-60">No incidents recorded.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {incidents.map((incident, index) => (
              <li key={`${incident.at}-${index}`} className="flex gap-3">
                <span className="tabular-nums opacity-60">{formatDateTime(incident.at)}</span>
                <span className="font-medium">{incident.type.replaceAll("_", " ").toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function QuestionCard({ question, finalized }: Readonly<{ question: ReviewQuestion; finalized: boolean }>) {
  const { answer } = question;
  const selected = new Set(answer?.response?.optionIds ?? []);
  const written = answer?.response?.text?.trim() ?? "";
  const answered = question.type === "WRITTEN" ? written.length > 0 : selected.size > 0;
  const awarded = answer?.awardedMarks ?? null;
  const tone =
    awarded === null
      ? "text-amber-700 dark:text-amber-300"
      : awarded >= question.marks
        ? "text-green-700 dark:text-green-400"
        : awarded > 0
          ? "text-blue-700 dark:text-blue-300"
          : "text-red-700 dark:text-red-400";

  return (
    <article className="rounded-xl border border-black/10 p-5 dark:border-white/15">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">Q{question.order}</span>
          <span className={typeBadge}>{question.type}</span>
          <span className="opacity-60">{question.topic}</span>
          {question.type === "MULTI" && (
            <span className="opacity-60">{question.multiScheme === "PARTIAL" ? "partial credit" : "all or nothing"}</span>
          )}
          {question.negativeMarks > 0 && <span className="opacity-60">−{formatMarks(question.negativeMarks)} if wrong</span>}
          {answer?.flagged && <span className="rounded bg-amber-100 px-1.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">flagged</span>}
        </div>
        <p className={`text-sm font-semibold tabular-nums ${tone}`}>
          {finalized ? (awarded === null ? "Not graded" : formatMarks(awarded)) : "—"} / {formatMarks(question.marks)}
        </p>
      </div>
      <p className="mt-2 whitespace-pre-wrap font-medium">{question.text}</p>

      {question.type === "WRITTEN" ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wide opacity-60">Candidate&apos;s answer</p>
          {answered ? (
            <p className="whitespace-pre-wrap break-words rounded-lg bg-black/3 p-3 text-sm dark:bg-white/5">{written}</p>
          ) : (
            <p className="text-sm italic opacity-60">Not answered{finalized ? " (auto-graded 0)" : ""}</p>
          )}
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5" aria-label="Options">
          {question.options.map((option) => {
            const picked = selected.has(option.id);
            const style = option.isCorrect
              ? "border-green-600/60 bg-green-50 dark:border-green-500/50 dark:bg-green-950/60"
              : picked
                ? "border-red-600/60 bg-red-50 dark:border-red-500/50 dark:bg-red-950/60"
                : "border-black/10 dark:border-white/15";
            return (
              <li key={option.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${style}`}>
                <span className="flex items-center gap-2">
                  <span aria-hidden className="w-4 text-center font-bold">
                    {option.isCorrect ? "✓" : picked ? "✗" : ""}
                  </span>
                  {option.text}
                </span>
                <span className="flex gap-2 text-xs whitespace-nowrap">
                  {option.isCorrect && <span className="font-semibold text-green-800 dark:text-green-300">Correct answer</span>}
                  {picked && <span className="font-semibold">Candidate&apos;s choice</span>}
                </span>
              </li>
            );
          })}
          {!answered && <li className="text-sm italic opacity-60">Not answered</li>}
        </ul>
      )}

      {answer?.feedback && (
        <p className="mt-3 rounded-lg border-l-4 border-blue-600 bg-blue-50 px-3 py-2 text-sm dark:bg-blue-950/60">
          <span className="font-medium">Feedback: </span>
          {answer.feedback}
        </p>
      )}
    </article>
  );
}
