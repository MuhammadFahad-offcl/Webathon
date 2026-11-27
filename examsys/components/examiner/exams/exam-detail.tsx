"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type { ExamDetail } from "@/lib/validation/exams";
import { primaryButton } from "@/components/examiner/users/user-dialog";
import { PreviewAsCandidateButton } from "@/components/examiner/sandbox/preview-button";
import { EXAM_TABS, findExamTab } from "./exam-tabs";
import { formatDateTime, formatDuration, formatMarks } from "./format";
import { Fact, Notice, PhaseBadge } from "./ui";

/** /examiner/exams/[id]: header with key facts + tab bar (`?tab=`). */
export function ExamDetailView() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const activeTab = findExamTab(searchParams.get("tab"));
  const justPublished = searchParams.get("published") === "1";

  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  /** Request that produced `exam`; tabs remount when a reload brings fresh data. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestKey = `${id}#${reloadKey}`;
  const loading = settledKey !== requestKey;
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ exam: ExamDetail }>(`/api/exams/${id}`)
      .then((result) => {
        if (cancelled) return;
        setExam(result.exam);
        setLoadedKey(requestKey);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiClientError ? { status: err.status, message: err.message } : { status: 0, message: "Could not load the exam" },
        );
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [id, requestKey]);

  const backLink = (
    <Link href="/examiner/exams" className="text-sm text-blue-700 hover:underline dark:text-blue-300">
      ← All exams
    </Link>
  );

  if (!exam) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8">
        {backLink}
        {error ? (
          <Notice tone="error" role="alert">
            {error.status === 404 ? "This exam doesn't exist or you don't have access to it." : error.message}{" "}
            {error.status !== 404 && (
              <button type="button" className="underline" onClick={reload}>
                Retry
              </button>
            )}
          </Notice>
        ) : (
          <p className="py-10 text-center text-sm opacity-60" aria-busy={loading}>
            Loading exam…
          </p>
        )}
      </div>
    );
  }

  const Tab = activeTab.Component;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-4">
        {backLink}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold break-words">{exam.title}</h1>
              <PhaseBadge phase={exam.phase} />
              {exam.resultsPublishedAt && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-200">
                  Results published
                </span>
              )}
            </div>
            <p className="text-sm opacity-70">Created by {exam.createdBy.name}</p>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <PreviewAsCandidateButton examId={exam.id} questionCount={exam.questionCount} />
            {exam.status === "DRAFT" && (
              <Link href={`/examiner/exams/${exam.id}/review`} className={primaryButton}>
                Review &amp; publish
              </Link>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 rounded-xl border border-black/10 p-4 text-sm sm:grid-cols-3 lg:grid-cols-6 dark:border-white/15">
          <Fact label="Opens" value={formatDateTime(exam.startAt)} />
          <Fact label="Closes" value={formatDateTime(exam.endAt)} />
          <Fact label="Duration" value={formatDuration(exam.durationMin)} />
          <Fact label="Questions" value={`${exam.questionCount} · ${formatMarks(exam.totalMarks)} marks`} />
          <Fact label="Enrolled" value={exam.enrolledCount} />
          <Fact label="Attempts" value={exam.attemptCount} />
        </dl>
      </header>

      {justPublished && exam.status === "PUBLISHED" && (
        <Notice tone="success" role="status">
          Exam published. Enrolled candidates will see it on their dashboard.
        </Notice>
      )}

      <nav aria-label="Exam sections" className="-mb-2 overflow-x-auto border-b border-black/10 dark:border-white/15">
        <ul className="flex min-w-max gap-1">
          {EXAM_TABS.map((tab) => {
            const active = tab.id === activeTab.id;
            return (
              <li key={tab.id}>
                <Link
                  href={`/examiner/exams/${exam.id}?tab=${tab.id}`}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px inline-block border-b-2 px-4 py-2.5 text-sm font-medium ${
                    active
                      ? "border-blue-600 text-blue-700 dark:text-blue-300"
                      : "border-transparent opacity-70 hover:border-black/20 hover:opacity-100 dark:hover:border-white/30"
                  }`}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Tab key={`${activeTab.id}#${loadedKey}`} exam={exam} onExamChange={setExam} reload={reload} />
    </div>
  );
}
