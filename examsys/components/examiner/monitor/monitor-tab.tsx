"use client";

import { useEffect, useState } from "react";
import type { ExamTabProps } from "@/components/examiner/exams/exam-tabs";
import { Card, Notice } from "@/components/examiner/exams/ui";
import { EnrollmentStatusBadge } from "@/components/examiner/enrollments/status-badge";
import { inputClass, secondaryButton } from "@/components/examiner/users/user-dialog";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { MONITOR_POLL_MS } from "@/lib/constants";
import { INCIDENT_TYPES, type IncidentTypeName, type MonitorAttempt, type MonitorResponse } from "@/lib/validation/monitor";
import { AnnouncementsPanel } from "./announcements-panel";
import { AttemptDrawer } from "./attempt-drawer";
import { describeMeta, formatAgo, formatTime, incidentLabel, presenceOf, type Presence } from "./format";

const DISCLAIMER = "Incidents are indicators for review, not proof of misconduct.";

/**
 * The exam page's "Monitor" tab. Polls GET /api/exams/:id/monitor every MONITOR_POLL_MS
 * while the browser tab is visible (paused when hidden, refreshed on return).
 */
export function MonitorTab({ exam }: Readonly<ExamTabProps>) {
  const examId = exam.id;
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  /** serverNow - client clock, so "last seen" is judged on server time. */
  const [skewMs, setSkewMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [typeFilter, setTypeFilter] = useState<IncidentTypeName | "">("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The incident filter `data` was fetched with (the feed hides stale results while it changes). */
  const [dataFilter, setDataFilter] = useState<string>("");

  // Polling loop: one request at a time, next one scheduled after the previous settles.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const url = `/api/exams/${examId}/monitor${typeFilter ? `?type=${typeFilter}` : ""}`;

    const isHidden = () => document.visibilityState === "hidden";

    const poll = async () => {
      if (cancelled || inFlight) return;
      if (isHidden()) {
        setPaused(true);
        return;
      }
      inFlight = true;
      setPaused(false);
      try {
        const body = await apiFetch<MonitorResponse>(url);
        if (cancelled) return;
        const received = Date.now();
        setData(body);
        setDataFilter(typeFilter);
        setError(null);
        setFetchedAt(received);
        setNow(received);
        setSkewMs(Date.parse(body.serverNow) - received);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not refresh the monitor");
      } finally {
        inFlight = false;
      }
      if (!cancelled && !isHidden()) timer = setTimeout(() => void poll(), MONITOR_POLL_MS);
    };

    const onVisibility = () => {
      clearTimeout(timer);
      if (isHidden()) setPaused(true);
      else void poll();
    };

    document.addEventListener("visibilitychange", onVisibility);
    timer = setTimeout(() => void poll(), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [examId, typeFilter, refreshKey]);

  // Ticks the "updated Xs ago" and "last seen" labels.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const serverNowMs = now + skewMs;
  const phase = data?.phase ?? exam.phase;
  const selected = data?.attempts.find((attempt) => attempt.attemptId === selectedId) ?? null;
  const incidents = data && dataFilter === typeFilter ? data.recentIncidents : null;

  let closedReason: string | null = null;
  if (exam.resultsPublishedAt) closedReason = "Results are published, so announcements are closed.";
  else if (phase === "COMPLETED") closedReason = "This exam has ended, so announcements are closed.";
  else if (phase === "DRAFT") closedReason = "Publish the exam to send announcements.";
  else if (phase === "ARCHIVED") closedReason = "This exam is archived.";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm opacity-80">
          <LiveDot paused={paused} />
          {paused
            ? "Paused while this tab is hidden"
            : fetchedAt
              ? `Live · updated ${formatAgo(now - fetchedAt)}`
              : "Loading…"}
        </p>
        <button type="button" className={secondaryButton} onClick={() => setRefreshKey((key) => key + 1)}>
          Refresh now
        </button>
      </div>

      {error && (
        <Notice tone="error" role="alert">
          {error}
          {data ? " Showing the last data received." : ""}{" "}
          <button type="button" className="underline" onClick={() => setRefreshKey((key) => key + 1)}>
            Retry
          </button>
        </Notice>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter label="Enrolled" value={data?.counts.enrolled} />
        <Counter label="Not started" value={data?.counts.notStarted} />
        <Counter label="In progress" value={data?.counts.inProgress} />
        <Counter label="Submitted" value={data?.counts.submitted} />
      </dl>

      <Notice tone="info">
        <strong className="font-semibold">{DISCLAIMER}</strong> Tab switches, disconnects and late syncs can have innocent
        causes; review them in context before drawing any conclusion.
      </Notice>

      <Card title="Candidates">
        {data && data.attempts.length === 0 ? (
          <EmptyState phase={phase} enrolled={data.counts.enrolled} />
        ) : (
          <AttemptsTable attempts={data?.attempts ?? null} serverNowMs={serverNowMs} onSelect={setSelectedId} />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Incident feed"
          actions={
            <label className="flex items-center gap-2 text-sm">
              <span className="opacity-70">Type</span>
              <select
                className={`${inputClass} py-1`}
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as IncidentTypeName | "")}
              >
                <option value="">All types</option>
                {INCIDENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {incidentLabel[type]}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          <p className="mb-3 text-xs opacity-70">{DISCLAIMER}</p>
          {!incidents && <p className="text-sm opacity-60">Loading…</p>}
          {incidents?.length === 0 && (
            <p className="text-sm opacity-60">{typeFilter ? "No incidents of this type." : "No incidents recorded."}</p>
          )}
          {incidents && incidents.length > 0 && (
            <ul className="flex max-h-96 flex-col divide-y divide-black/5 overflow-y-auto dark:divide-white/10">
              {incidents.map((incident) => (
                <li key={incident.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => setSelectedId(incident.attemptId)}
                    >
                      {incident.candidateName}
                    </button>{" "}
                    <span className="opacity-80">· {incidentLabel[incident.type]}</span>
                    {describeMeta(incident.meta) && <p className="truncate text-xs opacity-60">{describeMeta(incident.meta)}</p>}
                  </div>
                  <time dateTime={incident.at} className="shrink-0 text-xs tabular-nums opacity-70" title={formatTime(incident.at)}>
                    {formatAgo(Math.max(0, serverNowMs - Date.parse(incident.at)))}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <AnnouncementsPanel examId={examId} closedReason={closedReason} />
      </div>

      <AttemptDrawer examId={examId} attempt={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function LiveDot({ paused }: Readonly<{ paused: boolean }>) {
  return (
    <span
      aria-hidden
      className={`mr-2 inline-block size-2 rounded-full align-middle ${paused ? "bg-gray-400" : "animate-pulse bg-green-500"}`}
    />
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

function EmptyState({ phase, enrolled }: Readonly<{ phase: MonitorResponse["phase"]; enrolled: number }>) {
  let text = "No candidate has started yet. Their progress appears here as soon as they do.";
  if (phase === "DRAFT") text = "This exam is still a draft. Publish it and the live view fills in once candidates start.";
  else if (phase === "UPCOMING") text = "The exam hasn't started yet. Candidates appear here as soon as they begin.";
  else if (phase === "COMPLETED" || phase === "ARCHIVED") text = "This exam is over and no candidate took it.";
  return (
    <div className="py-8 text-center text-sm">
      <p className="opacity-70">{text}</p>
      {enrolled === 0 && phase !== "COMPLETED" && phase !== "ARCHIVED" && (
        <p className="mt-1 opacity-60">No candidates are enrolled yet (see the Candidates tab).</p>
      )}
    </div>
  );
}

const presenceStyle: Record<Presence, { label: string; dot: string }> = {
  online: { label: "Online", dot: "bg-green-500" },
  stale: { label: "Stale", dot: "bg-amber-500" },
  never: { label: "No heartbeat yet", dot: "bg-gray-400" },
  done: { label: "Finished", dot: "bg-blue-500" },
};

function AttemptsTable({
  attempts,
  serverNowMs,
  onSelect,
}: Readonly<{ attempts: MonitorAttempt[] | null; serverNowMs: number; onSelect: (attemptId: string) => void }>) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-180 text-left text-sm">
        <caption className="sr-only">Candidates&apos; live progress. Select a name to see the incident timeline.</caption>
        <thead className="bg-black/3 text-xs uppercase tracking-wide opacity-80 dark:bg-white/5">
          <tr>
            <th scope="col" className="px-5 py-3">Candidate</th>
            <th scope="col" className="px-4 py-3">Status</th>
            <th scope="col" className="px-4 py-3">Progress</th>
            <th scope="col" className="px-4 py-3">Last seen</th>
            <th scope="col" className="px-4 py-3">Incidents</th>
            <th scope="col" className="px-5 py-3">Late syncs</th>
          </tr>
        </thead>
        <tbody aria-busy={attempts === null}>
          {attempts === null && (
            <tr>
              <td colSpan={6} className="px-5 py-10 text-center opacity-60">
                Loading live data…
              </td>
            </tr>
          )}
          {attempts?.map((attempt) => {
            const presence = presenceOf(attempt, serverNowMs);
            const style = presenceStyle[presence];
            const percent = attempt.total ? Math.round((attempt.answered / attempt.total) * 100) : 0;
            return (
              <tr key={attempt.attemptId} className="border-t border-black/5 dark:border-white/10">
                <td className="px-5 py-3">
                  <button
                    type="button"
                    className="font-medium text-blue-700 hover:underline dark:text-blue-300"
                    onClick={() => onSelect(attempt.attemptId)}
                  >
                    {attempt.candidate.name}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <EnrollmentStatusBadge status={attempt.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div
                      role="progressbar"
                      aria-label={`${attempt.candidate.name}: answered`}
                      aria-valuemin={0}
                      aria-valuemax={attempt.total}
                      aria-valuenow={attempt.answered}
                      className="h-2 w-28 overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
                    >
                      <div className="h-full rounded-full bg-blue-600 dark:bg-blue-400" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="text-xs tabular-nums opacity-80">
                      {attempt.answered}/{attempt.total}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className={`size-2 rounded-full ${style.dot}`} />
                    <span>
                      {presence === "online" || presence === "stale" ? (
                        <>
                          {formatAgo(Math.max(0, serverNowMs - Date.parse(attempt.lastHeartbeatAt!)))}
                          <span className="ml-1 text-xs opacity-60">({style.label})</span>
                        </>
                      ) : presence === "done" && attempt.submittedAt ? (
                        <span className="opacity-70">Submitted {formatTime(attempt.submittedAt)}</span>
                      ) : (
                        <span className="opacity-70">{style.label}</span>
                      )}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  <CountBadge value={attempt.incidentCount} tone="amber" label="incidents" />
                </td>
                <td className="px-5 py-3">
                  <CountBadge value={attempt.lateSyncCount} tone="purple" label="late syncs" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CountBadge({ value, tone, label }: Readonly<{ value: number; tone: "amber" | "purple"; label: string }>) {
  if (value === 0) return <span className="tabular-nums opacity-50">0</span>;
  const colors =
    tone === "amber"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${colors}`}>
      {value}
      <span className="sr-only"> {label}</span>
    </span>
  );
}
