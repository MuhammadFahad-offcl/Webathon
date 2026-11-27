"use client";

import { useEffect, useState } from "react";
import { primaryButton } from "@/components/examiner/users/user-dialog";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type { EnrollmentItem, EnrollmentsResponse } from "@/lib/validation/enrollments";
import { AddCandidatesPanel } from "./add-candidates-panel";
import { ConfirmDialog } from "./confirm-dialog";
import { EnrollmentStatusBadge } from "./status-badge";

/** The exam page's "Candidates" tab: counters, enrolled list, add/remove. */
export function CandidatesTab({ examId }: Readonly<{ examId: string }>) {
  const [data, setData] = useState<EnrollmentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<EnrollmentItem | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const requestKey = `${examId}#${reloadKey}`;
  const loading = settledKey !== requestKey;
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    let cancelled = false;
    apiFetch<EnrollmentsResponse>(`/api/exams/${examId}/enrollments`)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not load candidates");
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [examId, requestKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await apiFetch(`/api/exams/${examId}/enrollments/${removing.userId}`, { method: "DELETE" });
      setToast(`Removed ${removing.name}`);
    } catch (err) {
      setToast(err instanceof ApiClientError ? err.message : "Could not remove the candidate");
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
      reload();
    }
  }

  const counts = data?.counts;
  const anyStarted = data?.items.some((item) => item.attemptId !== null) ?? false;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <dl className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <Counter label="Enrolled" value={counts?.enrolled} />
          <Counter label="Not started" value={counts?.notStarted} />
          <Counter label="In progress" value={counts?.inProgress} />
          <Counter label="Submitted" value={counts?.submitted} />
        </dl>
        {!adding && (
          <button type="button" className={primaryButton} onClick={() => setAdding(true)}>
            + Add candidates
          </button>
        )}
      </div>

      {adding && <AddCandidatesPanel examId={examId} onClose={() => setAdding(false)} onAdded={reload} />}

      {error && (
        <div role="alert" className="flex items-center justify-between rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
          {error}
          <button type="button" className="underline" onClick={reload}>
            Retry
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
        <table className="w-full min-w-160 text-left text-sm">
          <caption className="sr-only">Enrolled candidates</caption>
          <thead className="bg-black/3 text-xs uppercase tracking-wide opacity-80 dark:bg-white/5">
            <tr>
              <th scope="col" className="px-4 py-3">Name</th>
              <th scope="col" className="px-4 py-3">Email</th>
              <th scope="col" className="px-4 py-3">Roll no.</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3">Score</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {data?.items.map((item) => {
              const started = item.attemptId !== null;
              return (
                <tr key={item.userId} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-4 py-3 font-medium">{item.name}</td>
                  <td className="px-4 py-3">{item.email}</td>
                  <td className="px-4 py-3">{item.rollNo ?? "—"}</td>
                  <td className="px-4 py-3">
                    <EnrollmentStatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {item.status === "GRADED" && item.score !== null ? item.score : "—"}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline dark:text-red-400 dark:disabled:text-gray-500"
                      disabled={started}
                      title={started ? "This candidate has already started, so they can't be removed" : undefined}
                      aria-describedby={started ? "enrollment-remove-note" : undefined}
                      onClick={() => setRemoving(item)}
                    >
                      Remove<span className="sr-only"> {item.name}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center opacity-60">
                  No candidates are enrolled yet. Use “Add candidates” to enroll them.
                </td>
              </tr>
            )}
            {loading && !data && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center opacity-60">
                  Loading candidates…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {anyStarted && (
        <p id="enrollment-remove-note" className="-mt-4 text-xs opacity-60">
          Candidates who have started the exam can&apos;t be removed.
        </p>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Remove candidate?"
        message={removing ? `${removing.name} (${removing.email}) will no longer be able to take this exam.` : ""}
        confirmLabel="Remove"
        busy={removeBusy}
        onConfirm={() => void confirmRemove()}
        onClose={() => setRemoving(null)}
      />

      {toast && (
        <div role="status" className="fixed right-4 bottom-4 rounded-md bg-gray-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function Counter({ label, value }: Readonly<{ label: string; value: number | undefined }>) {
  return (
    <div className="rounded-lg border border-black/10 px-4 py-3 dark:border-white/15">
      <dt className="text-xs uppercase tracking-wide opacity-70">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value ?? "–"}</dd>
    </div>
  );
}
