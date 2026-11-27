"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { inputClass, primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";
import type { ExamTabProps } from "@/components/examiner/exams/exam-tabs";
import { formatMarks } from "@/components/examiner/exams/format";
import { Card, Notice } from "@/components/examiner/exams/ui";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import {
  FEEDBACK_MAX,
  MARKS_STEP,
  awardedMarksError,
  type GradeResponse,
  type QueueItem,
  type QueueResponse,
} from "@/lib/validation/grading";

/** Large enough to hold a whole exam's queue for one examiner session. */
const PAGE_SIZE = 100;

/**
 * The exam page's "Grading" tab: progress, filters and a queue of ungraded WRITTEN
 * answers with a side-by-side grading form ("Save & next").
 */
export function GradingTab({ exam }: Readonly<ExamTabProps>) {
  const [questionId, setQuestionId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Focus the marks input of the next form after "Save & next" (not on first load). */
  const [focusForm, setFocusForm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
  if (questionId) query.set("questionId", questionId);
  if (candidateId) query.set("candidateId", candidateId);
  const url = `/api/exams/${exam.id}/grading/queue?${query}`;
  const requestKey = `${url}#${reloadKey}`;
  const loading = settledKey !== requestKey;
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    let cancelled = false;
    apiFetch<QueueResponse>(url)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not load the grading queue");
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [url, requestKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const items = data?.items ?? [];
  const current = items.find((item) => item.answerId === selectedId) ?? items[0] ?? null;
  const currentIndex = current ? items.indexOf(current) : -1;
  const locked = Boolean(data?.resultsPublishedAt ?? exam.resultsPublishedAt);
  const filtered = Boolean(questionId || candidateId);

  function onSaved(item: QueueItem, result: GradeResponse) {
    setData((previous) => {
      if (!previous) return previous;
      const remaining = previous.items.filter((other) => other.answerId !== item.answerId);
      return {
        ...previous,
        items: remaining,
        total: Math.max(0, previous.total - 1),
        progress: { ...previous.progress, graded: Math.min(previous.progress.total, previous.progress.graded + 1) },
      };
    });
    // Move to the item that takes this one's place in the list.
    const next = items[currentIndex + 1] ?? items[currentIndex - 1] ?? null;
    setSelectedId(next?.answerId ?? null);
    setFocusForm(true);
    // The last loaded item is done but more wait beyond this page: fetch them.
    if (items.length === 1 && (data?.total ?? 0) > 1) reload();
    setToast(
      `Saved ${formatMarks(result.answer.awardedMarks)} / ${formatMarks(item.question.marks)} for ${item.candidate.name}` +
        (result.attempt.status === "GRADED" ? " · attempt fully graded" : ""),
    );
  }

  function onStale(message: string) {
    setToast(message);
    reload();
  }

  const progress = data?.progress;
  const percent = progress && progress.total ? Math.round((progress.graded / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="grading-progress-label" className="rounded-xl border border-black/10 p-5 dark:border-white/15">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="grading-progress-label" className="text-base font-semibold">
            Grading progress
          </h2>
          <p className="text-sm tabular-nums" aria-live="polite">
            {progress ? (
              <>
                <span className="text-lg font-semibold">
                  {progress.graded} / {progress.total}
                </span>{" "}
                written answers graded
              </>
            ) : (
              "–"
            )}
          </p>
        </div>
        <div
          role="progressbar"
          aria-labelledby="grading-progress-label"
          aria-valuemin={0}
          aria-valuemax={progress?.total ?? 0}
          aria-valuenow={progress?.graded ?? 0}
          className="mt-3 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
        >
          <div className="h-full rounded-full bg-green-600 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-xs opacity-60">
          Objective questions are graded automatically when an attempt is submitted; unanswered written questions get 0.
        </p>
      </section>

      {locked && (
        <Notice tone="info" role="status">
          Results are published, so grades are locked. See the Results tab.
        </Notice>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm sm:flex-none">
          <span className="font-medium">Question</span>
          <select
            className={inputClass}
            value={questionId}
            onChange={(event) => {
              setQuestionId(event.target.value);
              setSelectedId(null);
            }}
          >
            <option value="">All written questions</option>
            {data?.filters.questions.map((q) => (
              <option key={q.questionId} value={q.questionId}>
                Q{q.order}. {truncate(q.text, 60)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm sm:flex-none">
          <span className="font-medium">Candidate</span>
          <select
            className={inputClass}
            value={candidateId}
            onChange={(event) => {
              setCandidateId(event.target.value);
              setSelectedId(null);
            }}
          >
            <option value="">All candidates</option>
            {data?.filters.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              setQuestionId("");
              setCandidateId("");
              setSelectedId(null);
            }}
          >
            Clear filters
          </button>
        )}
        <button type="button" className={`${secondaryButton} ml-auto`} onClick={reload} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <Notice tone="error" role="alert">
          {error}{" "}
          <button type="button" className="underline" onClick={reload}>
            Retry
          </button>
        </Notice>
      )}

      {!data && loading && <p className="py-10 text-center text-sm opacity-60">Loading the grading queue…</p>}

      {data && items.length === 0 && (
        <Card>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            {filtered ? (
              <>
                <p className="font-medium">No ungraded answers match these filters.</p>
                <p className="text-sm opacity-70">Clear the filters to see the rest of the queue.</p>
              </>
            ) : progress && progress.total > 0 ? (
              <>
                <p className="text-lg font-semibold text-green-700 dark:text-green-400">All written answers are graded</p>
                <p className="text-sm opacity-70">
                  Review the scores and publish them in the{" "}
                  <Link href={`/examiner/exams/${exam.id}?tab=results`} className="text-blue-700 underline dark:text-blue-300">
                    Results tab
                  </Link>
                  .
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">Nothing to grade yet.</p>
                <p className="text-sm opacity-70">
                  Written answers appear here once candidates submit (or their time runs out).
                </p>
              </>
            )}
          </div>
        </Card>
      )}

      {data && current && (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Ungraded answers" className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-wide opacity-70">
              {data.total} waiting{data.total > items.length ? ` (showing ${items.length})` : ""}
            </p>
            <ul className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto rounded-xl border border-black/10 p-1 dark:border-white/15">
              {items.map((item) => {
                const active = item.answerId === current.answerId;
                return (
                  <li key={item.answerId}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        setSelectedId(item.answerId);
                        setFocusForm(true);
                      }}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        active ? "bg-blue-600 text-white" : "hover:bg-black/5 dark:hover:bg-white/10"
                      }`}
                    >
                      <span className="block font-medium">{item.candidate.name}</span>
                      <span className={`block truncate text-xs ${active ? "opacity-90" : "opacity-60"}`}>
                        Q{item.question.order} · {item.question.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <GradeForm
            key={current.answerId}
            examId={exam.id}
            item={current}
            position={`${currentIndex + 1} of ${items.length}`}
            locked={locked}
            autoFocus={focusForm}
            onSaved={(result) => onSaved(current, result)}
            onStale={onStale}
            onSkip={
              items.length > 1
                ? () => {
                    setSelectedId(items[(currentIndex + 1) % items.length].answerId);
                    setFocusForm(true);
                  }
                : undefined
            }
          />
        </div>
      )}

      {toast && (
        <div role="status" className="fixed right-4 bottom-4 z-10 rounded-md bg-gray-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

type FormProps = {
  examId: string;
  item: QueueItem;
  position: string;
  locked: boolean;
  autoFocus: boolean;
  onSaved: (result: GradeResponse) => void;
  /** The answer can't be graded any more (published, regraded elsewhere...): refresh the queue. */
  onStale: (message: string) => void;
  onSkip?: () => void;
};

/** Question + candidate answer side by side, with marks (0..max, step 0.5) and feedback. */
function GradeForm({ examId, item, position, locked, autoFocus, onSaved, onStale, onSkip }: Readonly<FormProps>) {
  const id = useId();
  const max = item.question.marks;
  const [marks, setMarks] = useState("");
  const [feedback, setFeedback] = useState(item.feedback ?? "");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const marksRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) marksRef.current?.focus();
  }, [autoFocus]);

  const value = marks.trim() === "" ? null : Number(marks);
  const marksError = awardedMarksError(value, max);
  const shownMarksError = serverErrors.awardedMarks || (touched ? marksError : null);
  const feedbackError = serverErrors.feedback || (feedback.length > FEEDBACK_MAX ? `At most ${FEEDBACK_MAX} characters` : null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setTouched(true);
    if (marksError || feedbackError || saving || locked) {
      if (marksError) marksRef.current?.focus();
      return;
    }
    setSaving(true);
    setServerErrors({});
    setFormError(null);
    try {
      const result = await apiFetch<GradeResponse>(`/api/answers/${item.answerId}/grade`, {
        method: "PATCH",
        body: JSON.stringify({ awardedMarks: value, feedback }),
      });
      onSaved(result);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 409 || err.status === 404) {
          onStale(err.message);
          return;
        }
        setServerErrors(err.fields);
        setFormError(Object.keys(err.fields).length ? null : err.message);
      } else {
        setFormError("Could not save the grade. Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  function onFeedbackKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit();
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${id}-title`} className="flex flex-col gap-5">
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
          <p className="text-xs uppercase tracking-wide opacity-60">
            Question {item.question.order} · {item.question.topic} · {formatMarks(max)} marks
          </p>
          <h3 id={`${id}-title`} className="mt-2 whitespace-pre-wrap font-medium">
            {item.question.text}
          </h3>
        </section>
        <section className="rounded-xl border border-black/10 bg-black/2 p-5 dark:border-white/15 dark:bg-white/3">
          <p className="text-xs uppercase tracking-wide opacity-60">
            {item.candidate.name}
            {item.candidate.rollNo ? ` · ${item.candidate.rollNo}` : ""} · answer {position}
          </p>
          <p className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
            {item.response.text}
          </p>
          <Link
            href={`/examiner/exams/${examId}/attempts/${item.attemptId}`}
            className="mt-3 inline-block text-xs text-blue-700 hover:underline dark:text-blue-300"
          >
            Open the full attempt
          </Link>
        </section>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={`${id}-marks`} className="font-medium">
            Marks (0–{formatMarks(max)})
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={marksRef}
              id={`${id}-marks`}
              type="number"
              inputMode="decimal"
              min={0}
              max={max}
              step={MARKS_STEP}
              value={marks}
              disabled={locked}
              onChange={(event) => {
                setMarks(event.target.value);
                setServerErrors((errors) => ({ ...errors, awardedMarks: "" }));
                if (event.target.value !== "") setTouched(true);
              }}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(shownMarksError)}
              aria-describedby={`${id}-marks-hint`}
              className={`${inputClass} w-28 tabular-nums`}
            />
            <span className="opacity-60">/ {formatMarks(max)}</span>
            <button type="button" className="text-xs text-blue-700 hover:underline dark:text-blue-300" onClick={() => { setMarks("0"); setTouched(true); }} disabled={locked}>
              0
            </button>
            <button type="button" className="text-xs text-blue-700 hover:underline dark:text-blue-300" onClick={() => { setMarks(String(max)); setTouched(true); }} disabled={locked}>
              Full
            </button>
          </div>
          <span id={`${id}-marks-hint`} className={shownMarksError ? "text-red-600 dark:text-red-400" : "opacity-60"}>
            {shownMarksError || `Steps of ${MARKS_STEP}. Press Enter to save.`}
          </span>
        </div>

        <div className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
          <label htmlFor={`${id}-feedback`} className="font-medium">
            Feedback <span className="font-normal opacity-60">(optional, shown with the result)</span>
          </label>
          <textarea
            id={`${id}-feedback`}
            rows={3}
            value={feedback}
            disabled={locked}
            onChange={(event) => setFeedback(event.target.value)}
            onKeyDown={onFeedbackKeyDown}
            maxLength={FEEDBACK_MAX + 200}
            aria-invalid={Boolean(feedbackError)}
            aria-describedby={`${id}-feedback-hint`}
            className={inputClass}
          />
          <span id={`${id}-feedback-hint`} className={feedbackError ? "text-red-600 dark:text-red-400" : "opacity-60"}>
            {feedbackError || `${feedback.length} / ${FEEDBACK_MAX} · Ctrl+Enter to save`}
          </span>
        </div>
      </div>

      {formError && (
        <Notice tone="error" role="alert">
          {formError}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryButton} disabled={saving || locked}>
          {saving ? "Saving…" : "Save & next"}
        </button>
        {onSkip && (
          <button type="button" className={secondaryButton} onClick={onSkip} disabled={saving}>
            Skip
          </button>
        )}
      </div>
    </form>
  );
}

function truncate(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
