"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";
import { ConfirmDialog } from "@/components/examiner/enrollments/confirm-dialog";
import { EnrollmentStatusBadge } from "@/components/examiner/enrollments/status-badge";
import type { ExamTabProps } from "@/components/examiner/exams/exam-tabs";
import { formatDateTime, formatMarks } from "@/components/examiner/exams/format";
import { Notice } from "@/components/examiner/exams/ui";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type {
  PublishBlocker,
  PublishResultsResponse,
  SubmissionItem,
  SubmissionsResponse,
} from "@/lib/validation/grading";
import { DownloadExamReportButton, DownloadReportButton } from "@/components/examiner/reports/download-report-button";

type SortKey = "name" | "score";
type Sort = { key: SortKey; dir: "asc" | "desc" };

/**
 * The exam page's "Results" tab: submissions table (sortable by name / score) with links to
 * each attempt's review, and "Publish results" via Member 1's POST /api/exams/:id/results/publish.
 */
export function ResultsTab({ exam, reload: reloadExam }: Readonly<ExamTabProps>) {
  const [data, setData] = useState<SubmissionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<{ message: string; blockers: PublishBlocker[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const requestKey = `${exam.id}#${reloadKey}`;
  const loading = settledKey !== requestKey;
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SubmissionsResponse>(`/api/exams/${exam.id}/submissions`)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not load submissions");
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [exam.id, requestKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await apiFetch<PublishResultsResponse>(`/api/exams/${exam.id}/results/publish`, { method: "POST" });
      setConfirmOpen(false);
      setToast(
        result.alreadyPublished
          ? "Results were already published"
          : `Results published · ${result.reportsIssued} verifiable report${result.reportsIssued === 1 ? "" : "s"} issued`,
      );
      reloadExam(); // refreshes the header + remounts the tabs in the published state
    } catch (err) {
      setConfirmOpen(false);
      if (err instanceof ApiClientError) {
        const blockers = Array.isArray(err.details?.blockers) ? (err.details.blockers as PublishBlocker[]) : [];
        setPublishError({ message: err.message, blockers });
        if (blockers.length) reload(); // the table should reflect what blocked publishing
      } else {
        setPublishError({ message: "Could not publish results. Try again.", blockers: [] });
      }
    } finally {
      setPublishing(false);
    }
  }

  const publishedAt = data?.exam.resultsPublishedAt ?? exam.resultsPublishedAt;
  const summary = data?.summary;
  const rows = data ? sortRows(data.items, sort) : [];
  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "score" ? "desc" : "asc" },
    );

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter label="Attempts" value={summary?.total} />
        <Counter label="In progress" value={summary?.inProgress} />
        <Counter label="Awaiting grading" value={summary?.submitted} hint={summary ? `${summary.pendingWritten} written answers` : undefined} />
        <Counter label="Graded" value={summary?.graded} />
      </dl>

      {publishedAt ? (
        <Notice tone="success" role="status">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <strong>Results published</strong> on {formatDateTime(publishedAt)}. Candidates can see their scores, grades are
              locked and the exam is closed to new attempts.
            </span>
            <DownloadExamReportButton examId={exam.id} />

          </div>
        </Notice>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 p-5 dark:border-white/15">
          <div className="text-sm">
            <p className="font-semibold">Publish results</p>
            <p className="opacity-70">
              {summary && (summary.inProgress > 0 || summary.pendingWritten > 0)
                ? `Before publishing: ${[
                    summary.inProgress > 0 && `${summary.inProgress} attempt${summary.inProgress === 1 ? " is" : "s are"} still in progress`,
                    summary.pendingWritten > 0 && `${summary.pendingWritten} written answer${summary.pendingWritten === 1 ? " needs" : "s need"} grading`,
                  ]
                    .filter(Boolean)
                    .join(", ")}.`
                : "Every attempt is finalized and graded. Publishing shows candidates their results and issues verifiable reports."}
            </p>
          </div>
          <button
            type="button"
            className={primaryButton}
            disabled={publishing || !data}
            onClick={() => {
              setPublishError(null);
              setConfirmOpen(true);
            }}
          >
            Publish results
          </button>
        </section>
      )}

      {publishError && (
        <Notice tone="warning" role="alert">
          <p className="font-medium">{publishError.message}</p>
          {publishError.blockers.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {publishError.blockers.map((blocker) => (
                <li key={`${blocker.type}-${blocker.attemptId}`}>
                  {blocker.type === "IN_PROGRESS" ? (
                    <>
                      <strong>{blocker.candidate.name}</strong> is still taking the exam (it finalizes automatically when
                      their time runs out).
                    </>
                  ) : (
                    <>
                      <strong>{blocker.candidate.name}</strong> has {blocker.count} ungraded written answer
                      {blocker.count === 1 ? "" : "s"} ·{" "}
                      <Link href={`/examiner/exams/${exam.id}?tab=grading`} className="underline">
                        Grade now
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {error && (
        <Notice tone="error" role="alert">
          {error}{" "}
          <button type="button" className="underline" onClick={reload}>
            Retry
          </button>
        </Notice>
      )}

      <div className="flex justify-end">
        <button type="button" className={secondaryButton} onClick={reload} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
        <table className="w-full min-w-200 text-left text-sm">
          <caption className="sr-only">Submissions and scores (sortable by candidate and score)</caption>
          <thead className="bg-black/3 text-xs uppercase tracking-wide opacity-80 dark:bg-white/5">
            <tr>
              <SortHeader label="Candidate" sortKey="name" sort={sort} onSort={toggleSort} />
              <th scope="col" className="px-4 py-3">Status</th>
              <SortHeader label="Score" sortKey="score" sort={sort} onSort={toggleSort} />
              <th scope="col" className="px-4 py-3">Submitted</th>
              <th scope="col" className="px-4 py-3">Pending</th>
              <th scope="col" className="px-4 py-3">Indicators</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {rows.map((item) => (
              <tr key={item.attemptId} className="border-t border-black/5 dark:border-white/10">
                <td className="px-4 py-3">
                  <span className="block font-medium">{item.candidate.name}</span>
                  <span className="block text-xs opacity-60">
                    {item.candidate.email}
                    {item.candidate.rollNo ? ` · ${item.candidate.rollNo}` : ""}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <EnrollmentStatusBadge status={item.status} />
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {item.score === null ? (
                    "—"
                  ) : (
                    <>
                      <span className="font-medium">
                        {formatMarks(item.score)} / {formatMarks(item.totalMarks)}
                      </span>
                      {item.totalMarks > 0 && (
                        <span className="ml-1 text-xs opacity-60">({Math.round((item.score / item.totalMarks) * 100)}%)</span>
                      )}
                      {item.status === "SUBMITTED" && <span className="block text-xs opacity-60">provisional</span>}
                    </>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{item.submittedAt ? formatDateTime(item.submittedAt) : "—"}</td>
                <td className="px-4 py-3 tabular-nums">
                  {item.pendingWritten > 0 ? (
                    <Link href={`/examiner/exams/${exam.id}?tab=grading`} className="text-amber-700 hover:underline dark:text-amber-300">
                      {item.pendingWritten} to grade
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap" title="Indicators for review, not proof of misconduct">
                  {item.incidentCount || item.lateSyncCount ? (
                    <>
                      {item.incidentCount} incident{item.incidentCount === 1 ? "" : "s"}
                      {item.lateSyncCount > 0 && ` · ${item.lateSyncCount} late sync`}
                    </>
                  ) : (
                    <span className="opacity-60">none</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <Link
                    href={`/examiner/exams/${exam.id}/attempts/${item.attemptId}`}
                    className="text-blue-700 hover:underline dark:text-blue-300"
                  >
                    Review<span className="sr-only"> {item.candidate.name}&apos;s attempt</span>
                  </Link>
                  {publishedAt && item.status === "GRADED" && (
                    <DownloadReportButton attemptId={item.attemptId} label="PDF" />
                  )}
                </td>
              </tr>
            ))}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center opacity-60">
                  No one has started this exam yet.
                </td>
              </tr>
            )}
            {loading && !data && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center opacity-60">
                  Loading submissions…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="-mt-4 text-xs opacity-60">
        Incident counts are indicators for review, not proof of misconduct. Sandbox previews are never listed.
      </p>

      <ConfirmDialog
        open={confirmOpen}
        title="Publish results?"
        message="Candidates will see their scores and verifiable reports will be issued. Grades are locked and the exam closes to new attempts. This can't be undone."
        confirmLabel="Publish results"
        busy={publishing}
        onConfirm={() => void publish()}
        onClose={() => setConfirmOpen(false)}
      />

      {toast && (
        <div role="status" className="fixed right-4 bottom-4 z-10 rounded-md bg-gray-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function sortRows(items: SubmissionItem[], sort: Sort) {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sort.key === "score") {
      // Unscored (in progress) attempts always go last.
      if (a.score === null || b.score === null) return a.score === b.score ? 0 : a.score === null ? 1 : -1;
      return (a.score - b.score) * factor || a.candidate.name.localeCompare(b.candidate.name);
    }
    return a.candidate.name.localeCompare(b.candidate.name) * factor;
  });
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: Readonly<{ label: string; sortKey: SortKey; sort: Sort; onSort: (key: SortKey) => void }>) {
  const active = sort.key === sortKey;
  return (
    <th scope="col" className="px-4 py-3" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:underline" onClick={() => onSort(sortKey)}>
        {label}
        <span aria-hidden className={active ? "" : "opacity-30"}>
          {active && sort.dir === "desc" ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );
}

function Counter({ label, value, hint }: Readonly<{ label: string; value: number | undefined; hint?: string }>) {
  return (
    <div className="rounded-lg border border-black/10 px-4 py-3 dark:border-white/15">
      <dt className="text-xs uppercase tracking-wide opacity-70">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value ?? "–"}</dd>
      {hint && <dd className="text-xs opacity-60">{hint}</dd>}
    </div>
  );
}
