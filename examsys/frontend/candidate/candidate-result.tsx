"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { Badge } from "@/frontend/components/ui/badge";
import { ErrorState } from "@/frontend/components/ui/error-state";
import { Skeleton } from "@/frontend/components/ui/skeleton";

type ResultPayload = {
  exam: { title: string };
  attempt: {
    id: string;
    submittedAt: string | null;
    score: number | null;
    totalMarks: number;
    percentage: number;
    passed: boolean;
  };
  questions: Array<{
    order: number;
    type: string;
    topic: string;
    text: string;
    marks: number;
    awardedMarks: number;
    outcome: "CORRECT" | "PARTIAL" | "INCORRECT" | "UNANSWERED";
  }>;
  topicBreakdown: Array<{ topic: string; awarded: number; total: number }>;
  report: { verifyCode: string; pdfUrl: string } | null;
};

type ResultView =
  | { state: "loading" }
  | { state: "awaiting" }
  | { state: "not-found" }
  | { state: "error"; message: string }
  | { state: "loaded"; result: ResultPayload };

const OUTCOME_LABELS: Record<ResultPayload["questions"][number]["outcome"], string> = {
  CORRECT: "Correct",
  PARTIAL: "Partially correct",
  INCORRECT: "Incorrect",
  UNANSWERED: "Unanswered",
};

export function CandidateResult({ attemptId }: Readonly<{ attemptId: string }>) {
  const router = useRouter();
  const [view, setView] = useState<ResultView>({ state: "loading" });
  const [reloadVersion, setReloadVersion] = useState(0);

  function retry() {
    setView({ state: "loading" });
    setReloadVersion((version) => version + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ResultPayload>(`/api/candidate/results/${encodeURIComponent(attemptId)}`, {
      signal: controller.signal,
    }).then((result) => {
      if (!controller.signal.aborted) setView({ state: "loaded", result });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiClientError && error.status === 401) {
        router.replace("/login");
        return;
      }
      if (error instanceof ApiClientError && error.status === 403) {
        setView({ state: "awaiting" });
        return;
      }
      if (error instanceof ApiClientError && error.status === 404) {
        setView({ state: "not-found" });
        return;
      }
      setView({
        state: "error",
        message: error instanceof ApiClientError
          ? error.message
          : "The result could not be loaded. Please try again.",
      });
    });
    return () => controller.abort();
  }, [attemptId, reloadVersion, router]);

  if (view.state === "loading") {
    return (
      <div className="results-page" aria-label="Loading result">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (view.state === "awaiting") {
    return (
      <div className="results-page">
        <section className="page-surface grid justify-items-start gap-4 p-6">
          <Badge tone="warning">Awaiting results</Badge>
          <h1 className="text-2xl font-bold">Your result is not published yet</h1>
          <p className="text-muted">Scores will appear here after the examiner publishes results.</p>
          <Link className="button-secondary" href="/dashboard">Back to my exams</Link>
        </section>
      </div>
    );
  }

  if (view.state === "not-found") {
    return (
      <div className="results-page">
        <ErrorState
          title="Result not found"
          description="This result does not exist or is not available to your account."
          action={<Link className="button-secondary" href="/dashboard">Back to my exams</Link>}
        />
      </div>
    );
  }

  if (view.state === "error") {
    return (
      <div className="results-page">
        <ErrorState
          title="Result could not be loaded"
          description={view.message}
          action={
            <button className="button-secondary" type="button" onClick={retry}>
              Try again
            </button>
          }
        />
      </div>
    );
  }

  const { result } = view;
  return (
    <div className="results-page">
      <header className="results-header">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-muted">Published result</p>
          <h1 className="mt-1 text-3xl font-bold">{result.exam.title}</h1>
          {result.attempt.submittedAt && (
            <p className="mt-2 text-sm text-muted">
              Submitted {new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(new Date(result.attempt.submittedAt))}
            </p>
          )}
        </div>
        <Badge tone={result.attempt.passed ? "success" : "danger"}>
          {result.attempt.passed ? "Passed" : "Not passed"}
        </Badge>
      </header>

      <section className="results-score page-surface" aria-label="Overall score">
        <div>
          <p className="text-sm font-semibold text-muted">Your score</p>
          <p className="results-score-value">
            {result.attempt.score ?? "—"}
            <span> / {result.attempt.totalMarks}</span>
          </p>
        </div>
        <div className="results-percentage">
          <span>{result.attempt.percentage.toFixed(1)}%</span>
          <span className="text-sm text-muted">Overall</span>
        </div>
        {result.report && (
          <div className="results-report-actions">
            <a className="button-primary" href={result.report.pdfUrl}>Download PDF report</a>
            <p className="text-xs text-muted">Verification code</p>
            <code className="results-verify-code">{result.report.verifyCode}</code>
            <Link className="text-sm text-[var(--brand)] underline" href={`/verify/${encodeURIComponent(result.report.verifyCode)}`}>
              Verify report
            </Link>
          </div>
        )}
      </section>

      <section className="page-surface results-section" aria-labelledby="topic-breakdown-heading">
        <h2 className="text-xl font-bold" id="topic-breakdown-heading">Topic breakdown</h2>
        {result.topicBreakdown.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No topic breakdown is available.</p>
        ) : (
          <ul className="results-topic-list">
            {result.topicBreakdown.map((topic) => {
              const percentage = topic.total > 0 ? Math.min(100, Math.max(0, topic.awarded / topic.total * 100)) : 0;
              return (
                <li className="results-topic" key={topic.topic}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{topic.topic}</span>
                    <span className="text-sm text-muted">{topic.awarded} / {topic.total}</span>
                  </div>
                  <div
                    className="results-topic-track"
                    role="progressbar"
                    aria-label={`${topic.topic} score`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(percentage)}
                  >
                    <span style={{ width: `${percentage}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="page-surface results-section" aria-labelledby="question-results-heading">
        <h2 className="text-xl font-bold" id="question-results-heading">Question results</h2>
        <ol className="results-question-list">
          {result.questions.map((question) => (
            <li className="results-question" key={question.order}>
              <div className="results-question-heading">
                <div>
                  <p className="text-sm font-bold">Question {question.order} · {question.topic}</p>
                  <p className="mt-1">{question.text}</p>
                </div>
                <Badge tone={question.outcome === "CORRECT" ? "success" : question.outcome === "PARTIAL" ? "warning" : "neutral"}>
                  {OUTCOME_LABELS[question.outcome]}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-muted">
                Awarded {question.awardedMarks} of {question.marks} marks
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
