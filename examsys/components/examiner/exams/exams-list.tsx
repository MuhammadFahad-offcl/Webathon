"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type { ExamPhaseName, ExamSummary } from "@/lib/validation/exams";
import { inputClass, primaryButton } from "@/components/examiner/users/user-dialog";
import { formatDateTime, formatDuration, formatMarks } from "./format";
import { PhaseBadge } from "./ui";

const PHASE_FILTERS: { value: "" | ExamPhaseName; label: string }[] = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "UPCOMING", label: "Upcoming" },
  { value: "ONGOING", label: "Ongoing" },
  { value: "COMPLETED", label: "Completed" },
];

export function ExamsList() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [phase, setPhase] = useState<"" | ExamPhaseName>("");
  const [items, setItems] = useState<ExamSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (phase) params.set("phase", phase);
    return params.toString();
  }, [debouncedSearch, phase]);
  const requestKey = `${query}#${reloadKey}`;
  const loading = settledKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: ExamSummary[] }>(`/api/exams?${query}`)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not load exams");
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  const filtered = Boolean(debouncedSearch || phase);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Exams</h1>
          <p className="text-sm opacity-70">Create exams, assign questions, then review and publish.</p>
        </div>
        <Link href="/examiner/exams/new" className={primaryButton}>
          + New exam
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-3" role="search">
        <input
          className={`${inputClass} min-w-60 flex-1`}
          placeholder="Search by title"
          aria-label="Search exams"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div role="group" aria-label="Filter by phase" className="flex flex-wrap gap-1 rounded-lg border border-black/10 p-1 dark:border-white/15">
          {PHASE_FILTERS.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              aria-pressed={phase === option.value}
              onClick={() => setPhase(option.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                phase === option.value ? "bg-blue-600 text-white" : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
          <button className="underline" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
        <table className="w-full min-w-200 text-left text-sm">
          <thead className="bg-black/3 text-xs uppercase tracking-wide opacity-80 dark:bg-white/5">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Phase</th>
              <th className="px-4 py-3">Opens</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3 text-right">Questions</th>
              <th className="px-4 py-3 text-right">Marks</th>
              <th className="px-4 py-3 text-right">Enrolled</th>
              <th className="px-4 py-3 text-right">Attempts</th>
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {items?.map((exam) => (
              <tr key={exam.id} className="border-t border-black/5 hover:bg-black/2 dark:border-white/10 dark:hover:bg-white/5">
                <td className="px-4 py-3">
                  <Link href={`/examiner/exams/${exam.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-300">
                    {exam.title}
                  </Link>
                  <div className="text-xs opacity-60">by {exam.createdBy.name}</div>
                </td>
                <td className="px-4 py-3">
                  <PhaseBadge phase={exam.phase} />
                  {exam.resultsPublishedAt && <div className="mt-1 text-xs opacity-70">Results published</div>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(exam.startAt)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDuration(exam.durationMin)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{exam.questionCount}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMarks(exam.totalMarks)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{exam.enrolledCount}</td>
                <td className="px-4 py-3 text-right tabular-nums">{exam.attemptCount}</td>
              </tr>
            ))}
            {!loading && items?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  {filtered ? (
                    <span className="opacity-60">No exams match these filters.</span>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <span className="opacity-70">You haven&apos;t created any exams yet.</span>
                      <Link href="/examiner/exams/new" className={primaryButton}>
                        Create your first exam
                      </Link>
                    </div>
                  )}
                </td>
              </tr>
            )}
            {loading && !items && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center opacity-60">
                  Loading exams…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
