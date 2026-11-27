"use client";

import { useEffect, useState, type ReactNode } from "react";
import { secondaryButton } from "@/components/examiner/users/user-dialog";
import { Card, Notice } from "@/components/examiner/exams/ui";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type { ExamAnalytics, QuestionAnalytics, QuestionAnalyticsItem } from "@/lib/validation/analytics";
import { QuestionTable } from "./question-table";
import { ScoreHistogram } from "./score-histogram";

type Data = { exam: ExamAnalytics; questions: QuestionAnalytics };

const fmt = (value: number | null, suffix = "") => (value === null ? "—" : `${value}${suffix}`);

/** Adapter for `EXAM_TABS` (receives the exam page's `ExamTabProps`). */
export function AnalyticsExamTab({ exam }: Readonly<{ exam: { id: string } }>) {
  return <AnalyticsTab examId={exam.id} />;
}

/** The exam page's "Analytics" tab (Member 2, Phase H). Real, finalized attempts only. */
export function AnalyticsTab({ examId }: Readonly<{ examId: string }>) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);

  const requestKey = `${examId}#${reloadKey}`;
  const loading = settledKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<ExamAnalytics>(`/api/exams/${examId}/analytics`),
      apiFetch<QuestionAnalytics>(`/api/exams/${examId}/questions/analytics`),
    ])
      .then(([exam, questions]) => {
        if (cancelled) return;
        setData({ exam, questions });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not load analytics");
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [examId, requestKey]);

  const refresh = (
    <button type="button" className={secondaryButton} onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
      {loading ? "Refreshing…" : "Refresh"}
    </button>
  );

  if (error && !data) {
    return (
      <Notice tone="error" role="alert">
        <div className="flex items-center justify-between gap-4">
          {error}
          <button type="button" className="underline" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </button>
        </div>
      </Notice>
    );
  }

  if (!data) {
    return (
      <Card title="Analytics">
        <p className="text-sm opacity-70" role="status">Loading analytics…</p>
      </Card>
    );
  }

  const { exam: stats, questions } = data;
  const { counts } = stats;

  if (counts.attempted === 0) {
    return (
      <Card title="Analytics" actions={refresh}>
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="font-medium">No finalized attempts yet</p>
          <p className="max-w-md text-sm opacity-70">
            Statistics appear once candidates submit (or their time runs out).{" "}
            {counts.inProgress > 0
              ? `${counts.inProgress} attempt${counts.inProgress === 1 ? " is" : "s are"} in progress right now.`
              : `${counts.enrolled} candidate${counts.enrolled === 1 ? " is" : "s are"} enrolled.`}{" "}
            Sandbox previews are never counted.
          </p>
        </div>
      </Card>
    );
  }

  const percent = (value: number | null) => (value === null ? "" : ` · ${value}%`);
  const flagged = questions.items.filter((item) => item.flags.length > 0);

  return (
    <div className="flex flex-col gap-6" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm opacity-70">
          Based on {counts.attempted} finalized attempt{counts.attempted === 1 ? "" : "s"} ({counts.enrolled} enrolled
          {counts.inProgress > 0 && `, ${counts.inProgress} still in progress`}). Sandbox previews are excluded.
        </p>
        {refresh}
      </div>

      {error && <Notice tone="error" role="alert">{error}</Notice>}
      {counts.pendingGrading > 0 && (
        <Notice tone="warning">
          {counts.pendingGrading} attempt{counts.pendingGrading === 1 ? " has" : "s have"} written answers awaiting grading, so
          {counts.pendingGrading === 1 ? " its score is" : " their scores are"} provisional.
        </Notice>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Attempts" value={counts.attempted} detail={`of ${counts.enrolled} enrolled`} />
        <Stat label="Average" value={fmt(stats.score.average)} detail={`of ${stats.exam.totalMarks}${percent(stats.percentage.average)}`} />
        <Stat label="Median" value={fmt(stats.score.median)} detail={`${fmt(stats.percentage.median, "%")}`} />
        <Stat label="Highest" value={fmt(stats.score.highest)} detail={`${fmt(stats.percentage.highest, "%")}`} />
        <Stat label="Lowest" value={fmt(stats.score.lowest)} detail={`${fmt(stats.percentage.lowest, "%")}`} />
        <Stat
          label="Avg time used"
          value={stats.avgTimeUsedMin === null ? "—" : `${stats.avgTimeUsedMin} min`}
          detail={`of ${stats.exam.durationMin} min`}
        />
      </dl>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Score distribution">
            <ScoreHistogram distribution={stats.distribution} passPercent={stats.passPercent} />
          </Card>
        </div>
        <Card title="Pass / fail">
          <PassFail passed={stats.passed} failed={stats.failed} passRate={stats.passRate} passPercent={stats.passPercent} />
        </Card>
      </div>

      <ProblemCallout items={flagged} />

      <Card title="Question analytics">
        {questions.items.length === 0 ? (
          <p className="text-sm opacity-70">No question data yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <QuestionTable items={questions.items} />
            <p className="text-xs opacity-70">
              Correct: objective questions need full marks; written answers need at least 50% of the marks (ungraded ones are
              left out). Discrimination compares the top and bottom 27% of attempts by total score (needs 4+ graded answers;
              negative means weaker candidates did better). Observed difficulty: ≥70% correct is easy, under 40% hard.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, detail }: Readonly<{ label: string; value: ReactNode; detail?: string }>) {
  return (
    <div className="rounded-lg border border-black/10 px-4 py-3 dark:border-white/15">
      <dt className="text-xs uppercase tracking-wide opacity-70">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {detail && <dd className="text-xs opacity-60">{detail}</dd>}
    </div>
  );
}

function PassFail({
  passed,
  failed,
  passRate,
  passPercent,
}: Readonly<{ passed: number; failed: number; passRate: number | null; passPercent: number }>) {
  const total = passed + failed;
  const passShare = total ? Math.round((passed / total) * 1000) / 10 : 0;
  const failShare = total ? Math.round((100 - passShare) * 10) / 10 : 0;
  return (
    <div className="flex flex-col gap-4">
      <p>
        <span className="text-3xl font-semibold tabular-nums">{passRate === null ? "—" : `${Math.round(passRate * 1000) / 10}%`}</span>{" "}
        <span className="text-sm opacity-70">pass rate (pass mark {passPercent}%)</span>
      </p>
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
        role="img"
        aria-label={`${passed} passed, ${failed} failed`}
      >
        {passed > 0 && <div className="h-full bg-green-600 dark:bg-green-500" style={{ width: `${passShare}%` }} />}
        {failed > 0 && <div className="h-full bg-red-500 dark:bg-red-400" style={{ width: `${failShare}%` }} />}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="flex items-center gap-1.5 opacity-80">
            <span aria-hidden className="size-2.5 rounded-full bg-green-600 dark:bg-green-500" />
            <span aria-hidden>✓</span> Passed
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {passed} <span className="text-sm font-normal opacity-60">({passShare}%)</span>
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 opacity-80">
            <span aria-hidden className="size-2.5 rounded-full bg-red-500 dark:bg-red-400" />
            <span aria-hidden>✕</span> Failed
          </dt>
          <dd className="text-lg font-semibold tabular-nums">
            {failed} <span className="text-sm font-normal opacity-60">({failShare}%)</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function reasons(item: QuestionAnalyticsItem): string[] {
  const list: string[] = [];
  if (item.flags.includes("LOW_CORRECT")) list.push(`only ${item.correctPct}% answered correctly (under 20%)`);
  if (item.flags.includes("HIGH_SKIPPED")) list.push(`${item.skippedPct}% skipped it (over 30%)`);
  if (item.mostChosenWrongOption && item.flags.includes("LOW_CORRECT")) {
    list.push(`most picked wrong answer: “${item.mostChosenWrongOption.text}” (${item.mostChosenWrongOption.count}×)`);
  }
  return list;
}

function ProblemCallout({ items }: Readonly<{ items: QuestionAnalyticsItem[] }>) {
  if (items.length === 0) {
    return <Notice tone="success">No problematic questions: none is under 20% correct or over 30% skipped.</Notice>;
  }
  return (
    <section
      aria-labelledby="problem-questions-title"
      className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <h2 id="problem-questions-title" className="flex items-center gap-2 text-base font-semibold">
        <span aria-hidden>⚠</span> Problematic questions ({items.length})
      </h2>
      <p className="mt-1 text-sm opacity-80">Worth a review: the key may be wrong, the wording unclear, or the topic not covered.</p>
      <ul className="mt-3 flex flex-col gap-2 text-sm">
        {items.map((item) => (
          <li key={item.questionId}>
            <span className="font-medium">{item.text.length > 120 ? `${item.text.slice(0, 117)}…` : item.text}</span>
            <span className="opacity-80"> — {reasons(item).join("; ")}.</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
