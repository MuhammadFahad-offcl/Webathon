"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import {
  DIFFICULTIES,
  QUESTION_TYPES,
  type QuestionDto,
  type QuestionListResponse,
} from "@/lib/validation/questions";
import { inputClass, primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";
import { DeleteQuestionDialog } from "./delete-question-dialog";
import { QuestionDialog } from "./question-dialog";
import { TYPE_SHORT, difficultyBadge, label } from "./labels";

const PAGE_SIZE = 20;

export function QuestionBank() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<QuestionListResponse | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; question: QuestionDto | null; session: number }>({
    open: false,
    question: null,
    session: 0,
  });
  const [deleting, setDeleting] = useState<QuestionDto | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (topic) params.set("topic", topic);
    if (difficulty) params.set("difficulty", difficulty);
    if (type) params.set("type", type);
    return params.toString();
  }, [page, debouncedSearch, topic, difficulty, type]);
  const requestKey = `${query}#${reloadKey}`;
  const loading = settledKey !== requestKey;
  const reload = () => setReloadKey((key) => key + 1);
  const filtered = Boolean(debouncedSearch || topic || difficulty || type);

  useEffect(() => {
    let cancelled = false;
    apiFetch<QuestionListResponse>(`/api/questions?${query}`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not load questions");
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  // Topics feed the filter and the editor's autocomplete; refreshed after every change.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ topics: string[] }>("/api/questions/topics")
      .then((result) => {
        if (!cancelled) setTopics(result.topics);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const openEditor = (question: QuestionDto | null) =>
    setEditor((current) => ({ open: true, question, session: current.session + 1 }));

  async function duplicate(question: QuestionDto) {
    try {
      const result = await apiFetch<{ question: QuestionDto }>(`/api/questions/${question.id}/duplicate`, {
        method: "POST",
      });
      setDeleting(null);
      setToast("Duplicated. Edit the copy below.");
      reload();
      openEditor(result.question);
    } catch (err) {
      setToast(err instanceof ApiClientError ? err.message : "Duplicate failed");
    }
  }

  const resetFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setTopic("");
    setDifficulty("");
    setType("");
    setPage(1);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Question bank</h1>
          <p className="text-sm opacity-70">Write, reuse and organise questions for your exams.</p>
        </div>
        <div className="flex gap-2">
          {/* CSV/JSON import lands here in PR 5. */}
          <button className={secondaryButton} disabled title="Coming in PR 5" aria-disabled>
            Import CSV
          </button>
          <button className={primaryButton} onClick={() => openEditor(null)}>
            + New question
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3" role="search">
        <input
          className={`${inputClass} min-w-60 flex-1`}
          placeholder="Search question text or topic"
          aria-label="Search questions"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={inputClass}
          aria-label="Filter by topic"
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value);
            setPage(1);
          }}
        >
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
          onChange={(e) => {
            setDifficulty(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {label(d)}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          aria-label="Filter by type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All types</option>
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_SHORT[t]}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
          <button className="underline" onClick={reload}>
            Retry
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="bg-black/3 text-xs uppercase tracking-wide opacity-80 dark:bg-white/5">
            <tr>
              <th className="px-4 py-3">Question</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Topic</th>
              <th className="px-4 py-3">Difficulty</th>
              <th className="px-4 py-3 text-right">Marks</th>
              <th className="px-4 py-3 text-right">Used in</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody aria-busy={loading} className={loading && data ? "opacity-60" : undefined}>
            {data?.items.map((question) => (
              <tr key={question.id} className="border-t border-black/5 align-top dark:border-white/10">
                <td className="max-w-md px-4 py-3">
                  <button
                    className="line-clamp-2 text-left font-medium hover:underline"
                    onClick={() => openEditor(question)}
                    title={question.text}
                  >
                    {question.text}
                  </button>
                  {question.type !== "WRITTEN" && (
                    <span className="text-xs opacity-60">
                      {question.options.length} options · {question.options.filter((o) => o.isCorrect).length} correct
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{TYPE_SHORT[question.type]}</td>
                <td className="px-4 py-3">{question.topic}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${difficultyBadge[question.difficulty]}`}>
                    {label(question.difficulty)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                  {question.defaultMarks}
                  {question.negativeMarks > 0 && (
                    <span className="ml-1 text-xs text-red-600 dark:text-red-400" title="Negative marks">
                      −{question.negativeMarks}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {question.usedInExams === 0 ? (
                    <span className="opacity-50">—</span>
                  ) : (
                    `${question.usedInExams} exam${question.usedInExams === 1 ? "" : "s"}`
                  )}
                </td>
                <td className="space-x-3 px-4 py-3 text-right whitespace-nowrap">
                  <button className="text-blue-600 hover:underline dark:text-blue-400" onClick={() => openEditor(question)}>
                    Edit
                  </button>
                  <button className="text-blue-600 hover:underline dark:text-blue-400" onClick={() => void duplicate(question)}>
                    Duplicate
                  </button>
                  <button className="text-red-600 hover:underline dark:text-red-400" onClick={() => setDeleting(question)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  {filtered ? (
                    <span className="opacity-60">
                      No questions match these filters.{" "}
                      <button className="underline" onClick={resetFilters}>
                        Clear filters
                      </button>
                    </span>
                  ) : (
                    <span className="flex flex-col items-center gap-3">
                      <span className="opacity-60">Your question bank is empty.</span>
                      <button className={primaryButton} onClick={() => openEditor(null)}>
                        Write your first question
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            )}
            {loading && !data && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center opacity-60">
                  Loading questions…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="opacity-70">
            {data.total} question{data.total === 1 ? "" : "s"} · page {data.page} of {data.totalPages}
          </span>
          <div className="flex gap-2">
            <button className={secondaryButton} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button className={secondaryButton} disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </nav>
      )}

      <QuestionDialog
        open={editor.open}
        question={editor.question}
        session={editor.session}
        topics={topics}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
        onSaved={(_question, created) => {
          setEditor((current) => ({ ...current, open: false }));
          setToast(created ? "Question created" : "Changes saved");
          reload();
        }}
      />

      <DeleteQuestionDialog
        question={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          setToast("Question deleted");
          reload();
        }}
        onDuplicate={(question) => void duplicate(question)}
      />

      {toast && (
        <div role="status" className="fixed right-4 bottom-4 rounded-md bg-gray-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
