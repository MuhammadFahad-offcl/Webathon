"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { MAX_QUESTION_MARKS, type ExamQuestionDto } from "@/lib/validation/exams";
import { inputClass, primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";
import { typeBadge } from "./ui";

/** Shape of `GET /api/questions` items (question bank API, PR 2). */
export type BankQuestion = {
  id: string;
  topic: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  type: "MCQ" | "MULTI" | "WRITTEN";
  text: string;
  defaultMarks: number;
  negativeMarks: number;
  options: { id: string; text: string; isCorrect: boolean; order: number }[];
  usedInExams: number;
  createdAt: string;
  createdBy: { id: string; name: string };
};

type ListResponse = { items: BankQuestion[]; page: number; pageSize: number; total: number; totalPages: number };

/** A question picked from the bank, ready to append to the exam's list. */
export type PickedQuestion = Omit<ExamQuestionDto, "order">;

type Props = {
  open: boolean;
  /** Question ids already on the exam; shown as "Added" and not selectable. */
  assignedIds: ReadonlySet<string>;
  onClose: () => void;
  onAdd: (questions: PickedQuestion[]) => void;
};

const PAGE_SIZE = 10;
const TYPE_LABEL: Record<BankQuestion["type"], string> = { MCQ: "MCQ", MULTI: "Multi", WRITTEN: "Written" };

export function QuestionPicker({ open, assignedIds, onClose, onAdd }: Readonly<Props>) {
  const ref = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [topics, setTopics] = useState<string[]>([]);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** Selection survives paging and filtering: questionId -> { question, marks (input text) }. */
  const [selected, setSelected] = useState<Map<string, { question: BankQuestion; marks: string }>>(new Map());

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<{ topics: string[] }>("/api/questions/topics")
      .then((result) => {
        if (!cancelled) setTopics(result.topics);
      })
      .catch(() => {
        // Topics are only a convenience filter; the list below reports real errors.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (topic) params.set("topic", topic);
    if (difficulty) params.set("difficulty", difficulty);
    if (type) params.set("type", type);
    return params.toString();
  }, [page, debouncedSearch, topic, difficulty, type]);
  const requestKey = `${query}#${reloadKey}`;
  const loading = open && settledKey !== requestKey;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<ListResponse>(`/api/questions?${query}`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 404) setError("The question bank isn't available yet.");
        else setError(err instanceof ApiClientError ? err.message : "Could not load questions");
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query, requestKey]);

  function toggle(question: BankQuestion) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(question.id)) next.delete(question.id);
      else next.set(question.id, { question, marks: String(question.defaultMarks) });
      return next;
    });
  }

  function setMarks(questionId: string, marks: string) {
    setSelected((current) => {
      const entry = current.get(questionId);
      if (!entry) return current;
      const next = new Map(current);
      next.set(questionId, { ...entry, marks });
      return next;
    });
  }

  const invalidMarks = [...selected.values()].some(({ marks }) => !validMarks(marks));

  function close() {
    setSelected(new Map());
    onClose();
  }

  function add() {
    if (invalidMarks || selected.size === 0) return;
    onAdd(
      [...selected.values()].map(({ question, marks }) => ({
        questionId: question.id,
        marks: Number(marks),
        type: question.type,
        topic: question.topic,
        difficulty: question.difficulty,
        text: question.text,
        optionCount: question.options.length,
      })),
    );
    setSelected(new Map());
  }

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <dialog
      ref={ref}
      onClose={close}
      aria-labelledby="question-picker-title"
      className="m-auto w-full max-w-4xl rounded-xl border border-black/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40 dark:border-white/15"
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex flex-col gap-3 border-b border-black/10 p-5 dark:border-white/15">
          <h2 id="question-picker-title" className="text-lg font-semibold">
            Add questions from the bank
          </h2>
          <div className="flex flex-wrap gap-2" role="search">
            <input
              className={`${inputClass} min-w-48 flex-1`}
              placeholder="Search question text"
              aria-label="Search questions"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className={inputClass} aria-label="Filter by topic" value={topic} onChange={(e) => resetPage(setTopic)(e.target.value)}>
              <option value="">All topics</option>
              {topics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              aria-label="Filter by difficulty"
              value={difficulty}
              onChange={(e) => resetPage(setDifficulty)(e.target.value)}
            >
              <option value="">Any difficulty</option>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
            <select className={inputClass} aria-label="Filter by type" value={type} onChange={(e) => resetPage(setType)(e.target.value)}>
              <option value="">Any type</option>
              <option value="MCQ">MCQ</option>
              <option value="MULTI">Multiple answer</option>
              <option value="WRITTEN">Written</option>
            </select>
          </div>
        </header>

        <div className="min-h-64 flex-1 overflow-y-auto p-5" aria-busy={loading}>
          {error ? (
            <div role="alert" className="flex items-center justify-between rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
              {error}
              <button type="button" className="underline" onClick={() => setReloadKey((key) => key + 1)}>
                Retry
              </button>
            </div>
          ) : loading && !data ? (
            <p className="py-10 text-center text-sm opacity-60">Loading questions…</p>
          ) : data && data.items.length === 0 ? (
            <p className="py-10 text-center text-sm opacity-60">No questions match these filters.</p>
          ) : (
            <ul className={`flex flex-col gap-2 ${loading ? "opacity-60" : ""}`}>
              {data?.items.map((question) => {
                const assigned = assignedIds.has(question.id);
                const entry = selected.get(question.id);
                const checkboxId = `pick-${question.id}`;
                return (
                  <li
                    key={question.id}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                      entry ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/40" : "border-black/10 dark:border-white/15"
                    } ${assigned ? "opacity-60" : ""}`}
                  >
                    <input
                      id={checkboxId}
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={assigned || Boolean(entry)}
                      disabled={assigned}
                      onChange={() => toggle(question)}
                    />
                    <label htmlFor={checkboxId} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1">
                      <span className="line-clamp-2">{question.text}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs opacity-80">
                        <span className={typeBadge}>{TYPE_LABEL[question.type]}</span>
                        <span className={typeBadge}>{question.topic}</span>
                        <span className={typeBadge}>{question.difficulty.toLowerCase()}</span>
                        {question.type !== "WRITTEN" && <span>{question.options.length} options</span>}
                        {assigned && <span className="font-medium text-green-700 dark:text-green-400">Added</span>}
                      </span>
                    </label>
                    <div className="flex w-24 shrink-0 flex-col gap-0.5">
                      <label htmlFor={`marks-${question.id}`} className="text-xs opacity-70">
                        Marks
                      </label>
                      <input
                        id={`marks-${question.id}`}
                        type="number"
                        min={0.25}
                        step={0.25}
                        max={MAX_QUESTION_MARKS}
                        className={`${inputClass} py-1`}
                        disabled={!entry}
                        value={entry ? entry.marks : String(question.defaultMarks)}
                        aria-invalid={entry ? !validMarks(entry.marks) : undefined}
                        onChange={(e) => setMarks(question.id, e.target.value)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 p-4 dark:border-white/15">
          <div className="flex items-center gap-3 text-sm">
            {data && data.totalPages > 1 && (
              <nav className="flex items-center gap-2" aria-label="Question pages">
                <button type="button" className={secondaryButton} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ‹ Prev
                </button>
                <span className="opacity-70">
                  {data.page} / {data.totalPages}
                </span>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next ›
                </button>
              </nav>
            )}
            <span aria-live="polite">
              {selected.size} selected
              {invalidMarks && <span className="text-red-600 dark:text-red-400"> · marks must be between 0 and {MAX_QUESTION_MARKS}</span>}
            </span>
          </div>
          <div className="flex gap-2">
            <button type="button" className={secondaryButton} onClick={close}>
              Cancel
            </button>
            <button type="button" className={primaryButton} disabled={selected.size === 0 || invalidMarks} onClick={add}>
              Add {selected.size || ""} question{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

function validMarks(value: string) {
  const marks = Number(value);
  return value.trim() !== "" && Number.isFinite(marks) && marks > 0 && marks <= MAX_QUESTION_MARKS;
}
