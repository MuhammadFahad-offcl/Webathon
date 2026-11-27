"use client";

import { useEffect, useRef, useState } from "react";
import { EnrollmentStatusBadge } from "@/components/examiner/enrollments/status-badge";
import { secondaryButton } from "@/components/examiner/users/user-dialog";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type { MonitorAttempt, MonitorIncident, MonitorResponse } from "@/lib/validation/monitor";
import { describeMeta, formatTime, incidentLabel } from "./format";

type Props = {
  examId: string;
  attempt: MonitorAttempt | null;
  onClose: () => void;
};

/** Side drawer (native <dialog>) with one attempt's incident timeline. */
export function AttemptDrawer({ examId, attempt, onClose }: Readonly<Props>) {
  const ref = useRef<HTMLDialogElement>(null);
  const [timeline, setTimeline] = useState<{ key: string; items: MonitorIncident[] } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  const open = attempt !== null;
  const attemptId = attempt?.attemptId ?? null;
  // Refetch when the drawer opens on another attempt or that attempt gets a new incident.
  const requestKey = attempt ? `${attempt.attemptId}#${attempt.incidentCount}` : null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!requestKey || !attemptId) return;
    let cancelled = false;
    apiFetch<MonitorResponse>(`/api/exams/${examId}/monitor?attemptId=${encodeURIComponent(attemptId)}`)
      .then((body) => {
        if (!cancelled) setTimeline({ key: requestKey, items: body.recentIncidents });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError({ key: requestKey, message: err instanceof ApiClientError ? err.message : "Could not load the timeline" });
      });
    return () => {
      cancelled = true;
    };
  }, [examId, attemptId, requestKey]);

  const loadError = error?.key === requestKey ? error.message : null;
  // While a refresh for a new incident loads, keep showing this attempt's previous timeline.
  const lastItems = timeline && attempt && timeline.key.startsWith(`${attempt.attemptId}#`) ? timeline.items : null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="attempt-drawer-title"
      className="mr-0 ml-auto h-dvh max-h-dvh w-full max-w-md rounded-none border-l border-black/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40 dark:border-white/15"
    >
      {attempt && (
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-black/10 p-5 dark:border-white/15">
            <div>
              <h2 id="attempt-drawer-title" className="text-lg font-semibold">
                {attempt.candidate.name}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm opacity-80">
                <EnrollmentStatusBadge status={attempt.status} />
                <span>
                  {attempt.answered}/{attempt.total} answered
                </span>
                <span>· started {formatTime(attempt.startedAt)}</span>
                {attempt.lateSyncCount > 0 && <span>· {attempt.lateSyncCount} late sync</span>}
              </div>
            </div>
            <button type="button" className={secondaryButton} onClick={onClose} autoFocus>
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <h3 className="mb-1 text-sm font-semibold">Incident timeline</h3>
            <p className="mb-4 text-xs opacity-70">Incidents are indicators for review, not proof of misconduct.</p>
            {loadError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {loadError}
              </p>
            )}
            {!lastItems && !loadError && <p className="text-sm opacity-60">Loading timeline…</p>}
            {lastItems && lastItems.length === 0 && <p className="text-sm opacity-60">No incidents recorded for this attempt.</p>}
            {lastItems && lastItems.length > 0 && (
              <ol className="relative flex flex-col gap-4 border-l border-black/10 pl-4 dark:border-white/15">
                {lastItems.map((incident) => (
                  <li key={incident.id} className="relative">
                    <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-amber-500" />
                    <div className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="font-medium">{incidentLabel[incident.type]}</span>
                      <time dateTime={incident.at} className="text-xs tabular-nums opacity-70">
                        {formatTime(incident.at)}
                      </time>
                    </div>
                    {describeMeta(incident.meta) && <p className="text-xs opacity-70">{describeMeta(incident.meta)}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
