"use client";

/*
 * Temporary until Member 3's exam workspace lands — replace the import in the sandbox page.
 * (The sandbox page takes its workspace from `components/examiner/sandbox/workspace.ts`; point
 * that one export at Member 3's component and delete this file.)
 *
 * A deliberately small candidate workspace on Member 1's real attempt APIs, so the sandbox
 * preview exercises exactly what candidates use:
 *   GET  /api/attempts/:id          load questions, saved answers and the server-timed clock
 *   PUT  /api/attempts/:id/answers  debounced autosave; `seq` increases per question from 1
 *   POST /api/attempts/:id/submit   finalize (objective answers are auto-marked)
 */

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/frontend/components/ui/button";
import { Checkbox } from "@/frontend/components/ui/checkbox";
import { Dialog } from "@/frontend/components/ui/dialog";
import { ErrorState } from "@/frontend/components/ui/error-state";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { Radio } from "@/frontend/components/ui/radio";
import { Skeleton } from "@/frontend/components/ui/skeleton";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { AUTOSAVE_DEBOUNCE_MS, WRITTEN_MAX_CHARS } from "@/lib/constants";

export type ExamWorkspaceProps = {
  attemptId: string;
  /** Called once the attempt is closed (submitted now, or already closed when opened). */
  onSubmitted: (status: string) => void;
};

type QuestionType = "MCQ" | "MULTI" | "WRITTEN";
type WorkspaceQuestion = { id: string; order: number; type: QuestionType; text: string; marks: number; options: { id: string; text: string }[] };
type LoadedAttempt = {
  serverNow: string;
  attempt: { id: string; status: string; startedAt: string; expiresAt: string; remainingMs: number; inGrace: boolean };
  exam: { title: string; instructions: string; durationMin: number; totalMarks: number };
  questions: WorkspaceQuestion[];
  answers: Record<string, { response: unknown; flagged: boolean; seq: number }>;
};
type AnswerResponse = { optionIds: string[] } | { text: string };
type AnswerState = { response: AnswerResponse; flagged: boolean };
type SaveResponse = { serverNow: string; expiresAt: string; results: { questionId: string; status: string }[] };
type SaveState = { kind: "idle" | "saving" | "saved" | "error"; message?: string };

const typeLabel: Record<QuestionType, string> = { MCQ: "Single choice", MULTI: "Multiple choice", WRITTEN: "Written" };

function toResponse(type: QuestionType, raw: unknown): AnswerResponse {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (type === "WRITTEN") return { text: typeof value.text === "string" ? value.text : "" };
  const ids = Array.isArray(value.optionIds) ? value.optionIds.filter((id): id is string => typeof id === "string") : [];
  return { optionIds: ids };
}

function isAnswered(answer: AnswerState | undefined) {
  if (!answer) return false;
  const r = answer.response;
  return "text" in r ? r.text.trim().length > 0 : r.optionIds.length > 0;
}

function formatClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function SandboxWorkspace({ attemptId, onSubmitted }: Readonly<ExamWorkspaceProps>) {
  const [data, setData] = useState<LoadedAttempt | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  /** serverNow - client clock at load, so the countdown runs on server time. */
  const [skewMs, setSkewMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const answersRef = useRef<Record<string, AnswerState>>({});
  const seqRef = useRef(new Map<string, number>());
  const dirtyRef = useRef(new Set<string>());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const clockRef = useRef({ skewMs: 0, startedAtMs: 0 });
  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<LoadedAttempt>(`/api/attempts/${attemptId}`)
      .then((body) => {
        if (cancelled) return;
        if (body.attempt.status !== "IN_PROGRESS") {
          onSubmitted(body.attempt.status);
          return;
        }
        const initial: Record<string, AnswerState> = {};
        for (const q of body.questions) {
          const saved = body.answers[q.id];
          initial[q.id] = { response: toResponse(q.type, saved?.response), flagged: saved?.flagged ?? false };
        }
        const skew = Date.parse(body.serverNow) - Date.now();
        seqRef.current = new Map(Object.entries(body.answers).map(([id, saved]) => [id, saved.seq]));
        answersRef.current = initial;
        clockRef.current = { skewMs: skew, startedAtMs: Date.parse(body.attempt.startedAt) };
        setAnswers(initial);
        setSkewMs(skew);
        setNow(Date.now());
        setData(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof ApiClientError ? err.message : "Could not load the preview.");
      });
    return () => {
      cancelled = true;
    };
  }, [attemptId, onSubmitted]);

  /** Sends every changed answer now; saves run one after another so `seq` order holds. */
  const flush = useCallback((): Promise<void> => {
    clearTimeout(debounceRef.current);
    const ids = [...dirtyRef.current];
    if (ids.length === 0) return chainRef.current;
    dirtyRef.current.clear();
    const { skewMs: skew, startedAtMs } = clockRef.current;
    const items = ids.map((questionId) => {
      const seq = (seqRef.current.get(questionId) ?? 0) + 1;
      seqRef.current.set(questionId, seq);
      const answer = answersRef.current[questionId];
      return { questionId, response: answer.response, flagged: answer.flagged, seq, elapsedMs: Math.max(0, Date.now() + skew - startedAtMs) };
    });
    chainRef.current = chainRef.current.then(async () => {
      setSaveState({ kind: "saving" });
      try {
        const result = await apiFetch<SaveResponse>(`/api/attempts/${attemptId}/answers`, {
          method: "PUT",
          body: JSON.stringify({ items }),
        });
        const refused = result.results.filter((r) => r.status !== "saved" && r.status !== "ignored_stale");
        setSaveState(
          refused.length
            ? { kind: "error", message: `${refused.length} answer${refused.length === 1 ? " was" : "s were"} not accepted (time may be up).` }
            : { kind: "saved" },
        );
      } catch (err) {
        for (const id of ids) dirtyRef.current.add(id); // retried with a higher seq on the next save
        setSaveState({ kind: "error", message: err instanceof ApiClientError ? err.message : "Could not save. Check your connection." });
      }
    });
    return chainRef.current;
  }, [attemptId]);

  function update(questionId: string, change: Partial<AnswerState>) {
    const next = { ...answersRef.current, [questionId]: { ...answersRef.current[questionId], ...change } };
    answersRef.current = next;
    setAnswers(next);
    dirtyRef.current.add(questionId);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS);
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await flush();
      const result = await apiFetch<{ status: string }>(`/api/attempts/${attemptId}/submit`, { method: "POST" });
      setConfirmOpen(false);
      onSubmitted(result.status);
    } catch (err) {
      setSubmitError(err instanceof ApiClientError ? err.message : "Could not submit. Please try again.");
      setSubmitting(false);
    }
  }

  const onTick = useEffectEvent(() => {
    const current = Date.now();
    setNow(current);
    if (!data || autoSubmittedRef.current || submitting) return;
    if (Date.parse(data.attempt.expiresAt) - (current + skewMs) <= 0) {
      autoSubmittedRef.current = true;
      void submit();
    }
  });

  useEffect(() => {
    if (!data) return;
    const timer = setInterval(() => onTick(), 1000);
    return () => clearInterval(timer);
  }, [data]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  if (loadError) {
    return <ErrorState title="Could not open the preview" description={loadError} />;
  }
  if (!data) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-20" label="Loading preview" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const remainingMs = Date.parse(data.attempt.expiresAt) - (now + skewMs);
  const timeUp = remainingMs <= 0;
  const total = data.questions.length;
  const answeredCount = data.questions.filter((q) => isAnswered(answers[q.id])).length;
  const flaggedCount = data.questions.filter((q) => answers[q.id]?.flagged).length;
  const locked = timeUp || submitting;

  return (
    <div className="grid gap-5">
      <section className="page-surface grid gap-3 p-5" aria-label="Exam status">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold break-words">{data.exam.title}</h1>
            <p className="text-sm text-muted">
              {total} question{total === 1 ? "" : "s"} · {data.exam.totalMarks} marks · {data.exam.durationMin} min
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Time left</p>
            <p
              className={`font-mono text-2xl font-bold tabular-nums ${remainingMs < 60_000 ? "text-[var(--danger)]" : ""}`}
              aria-label={timeUp ? "Time is up" : `Time left ${formatClock(remainingMs)}`}
            >
              {timeUp ? "Time is up" : formatClock(remainingMs)}
            </p>
          </div>
        </div>
        <ProgressBar value={total ? (answeredCount / total) * 100 : 0} label={`${answeredCount} of ${total} answered`} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {answeredCount} of {total} answered{flaggedCount ? ` · ${flaggedCount} flagged` : ""}
          </span>
          <span aria-live="polite" className={saveState.kind === "error" ? "text-[var(--danger)]" : "text-muted"}>
            {saveState.kind === "saving" && "Saving…"}
            {saveState.kind === "saved" && "All changes saved"}
            {saveState.kind === "error" && (saveState.message ?? "Some changes were not saved")}
          </span>
        </div>
        <nav aria-label="Questions" className="flex flex-wrap gap-2">
          {data.questions.map((q) => {
            const answer = answers[q.id];
            return (
              <a
                key={q.id}
                href={`#q-${q.id}`}
                className={`grid size-9 place-items-center rounded-lg border text-sm font-semibold ${
                  isAnswered(answer) ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-contrast)]" : "border-[var(--border)]"
                } ${answer?.flagged ? "ring-2 ring-[var(--warning)] ring-offset-1" : ""}`}
                aria-label={`Question ${q.order}${isAnswered(answer) ? ", answered" : ", not answered"}${answer?.flagged ? ", flagged" : ""}`}
              >
                {q.order}
              </a>
            );
          })}
        </nav>
      </section>

      {data.exam.instructions.trim() && (
        <details className="page-surface p-5">
          <summary className="cursor-pointer font-semibold">Instructions</summary>
          <p className="mt-3 text-sm whitespace-pre-wrap">{data.exam.instructions}</p>
        </details>
      )}

      {data.questions.map((q) => {
        const answer = answers[q.id];
        const response = answer?.response;
        return (
          <fieldset key={q.id} id={`q-${q.id}`} className="page-surface grid scroll-mt-24 gap-4 p-5" disabled={locked}>
            <legend className="sr-only">Question {q.order}</legend>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Question {q.order} · {typeLabel[q.type]} · {q.marks} mark{q.marks === 1 ? "" : "s"}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{q.text}</p>
              </div>
              <Button
                variant="secondary"
                className="min-h-0 px-3 py-1 text-sm"
                aria-pressed={answer?.flagged ?? false}
                onClick={() => update(q.id, { flagged: !answer?.flagged })}
              >
                {answer?.flagged ? "Flagged" : "Flag for review"}
              </Button>
            </div>

            {q.type === "WRITTEN" && response && "text" in response && (
              <div className="grid gap-1">
                <label htmlFor={`answer-${q.id}`} className="sr-only">
                  Your answer to question {q.order}
                </label>
                <textarea
                  id={`answer-${q.id}`}
                  className="field-control min-h-36"
                  value={response.text}
                  maxLength={WRITTEN_MAX_CHARS}
                  onChange={(event) => update(q.id, { response: { text: event.target.value } })}
                />
                <span className="text-right text-xs text-muted">
                  {response.text.length} / {WRITTEN_MAX_CHARS}
                </span>
              </div>
            )}

            {q.type !== "WRITTEN" && response && "optionIds" in response && (
              <div className="grid gap-2">
                {q.options.map((option) => {
                  const checked = response.optionIds.includes(option.id);
                  const toggle = () => {
                    let optionIds = [option.id];
                    if (q.type === "MULTI") {
                      optionIds = checked ? response.optionIds.filter((id) => id !== option.id) : [...response.optionIds, option.id];
                    }
                    update(q.id, { response: { optionIds } });
                  };
                  return (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] px-3 py-2 hover:bg-[var(--surface-2)]"
                    >
                      {q.type === "MCQ" ? (
                        <Radio name={`q-${q.id}`} checked={checked} onChange={toggle} className="mt-1" />
                      ) : (
                        <Checkbox checked={checked} onChange={toggle} className="mt-1" />
                      )}
                      <span className="break-words">{option.text}</span>
                    </label>
                  );
                })}
                {q.type === "MCQ" && response.optionIds.length > 0 && (
                  <button
                    type="button"
                    className="justify-self-start text-sm underline"
                    onClick={() => update(q.id, { response: { optionIds: [] } })}
                  >
                    Clear selection
                  </button>
                )}
              </div>
            )}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {submitError && !confirmOpen && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {submitError}
          </p>
        )}
        <Button onClick={() => setConfirmOpen(true)} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit preview"}
        </Button>
      </div>

      <Dialog open={confirmOpen} title="Submit this preview?" onClose={() => setConfirmOpen(false)}>
        <div className="grid gap-4 text-sm">
          <p>
            You answered {answeredCount} of {total} question{total === 1 ? "" : "s"}
            {flaggedCount ? ` and flagged ${flaggedCount}` : ""}. Objective answers are marked automatically, as they
            would be for a candidate. Nothing is recorded.
          </p>
          {submitError && (
            <p role="alert" className="text-[var(--danger)]">
              {submitError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Keep answering
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit preview"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
