"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { windowMinutes, type ExamDetail, type PublishCheck } from "@/lib/validation/exams";
import { primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";
import { formatDateTime, formatDuration, formatMarks, useTimeZone } from "./format";
import { Card, Fact, Notice, PhaseBadge, typeBadge } from "./ui";

type Loaded = { exam: ExamDetail; check: PublishCheck };

/** /examiner/exams/[id]/review - review-before-publish summary + confirm dialog. */
export function ExamReview() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const timeZone = useTimeZone();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<{ message: string; blockers: string[] } | null>(null);
  const requestKey = `${id}#${reloadKey}`;
  const loading = settledKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<{ exam: ExamDetail }>(`/api/exams/${id}`),
      apiFetch<PublishCheck>(`/api/exams/${id}/publish-check`),
    ])
      .then(([examResult, check]) => {
        if (cancelled) return;
        setData({ exam: examResult.exam, check });
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiClientError ? { status: err.status, message: err.message } : { status: 0, message: "Could not load the exam" },
        );
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [id, requestKey]);

  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      await apiFetch<{ exam: ExamDetail }>(`/api/exams/${id}/publish`, { method: "POST" });
      router.push(`/examiner/exams/${id}?published=1`);
    } catch (err) {
      setConfirmOpen(false);
      if (err instanceof ApiClientError) {
        const blockers = Array.isArray(err.details?.blockers) ? (err.details.blockers as string[]) : [];
        setPublishError({ message: err.message, blockers });
      } else {
        setPublishError({ message: "Something went wrong", blockers: [] });
      }
      setReloadKey((key) => key + 1);
    } finally {
      setPublishing(false);
    }
  }

  const detailHref = `/examiner/exams/${id}`;
  const backLink = (
    <Link href={detailHref} className="text-sm text-blue-700 hover:underline dark:text-blue-300">
      ← Back to exam
    </Link>
  );

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8">
        {backLink}
        {error ? (
          <Notice tone="error" role="alert">
            {error.status === 404 ? "This exam doesn't exist or you don't have access to it." : error.message}{" "}
            {error.status !== 404 && (
              <button type="button" className="underline" onClick={() => setReloadKey((key) => key + 1)}>
                Retry
              </button>
            )}
          </Notice>
        ) : (
          <p className="py-10 text-center text-sm opacity-60" aria-busy={loading}>
            Checking the exam…
          </p>
        )}
      </div>
    );
  }

  const { exam, check } = data;
  const marksSum = Math.round(exam.questions.reduce((sum, q) => sum + q.marks, 0) * 100) / 100;
  const marksMatch = Math.abs(marksSum - exam.totalMarks) < 0.001;
  const windowMin = windowMinutes(new Date(exam.startAt), new Date(exam.endAt));
  const isDraft = exam.status === "DRAFT";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-2">
        {backLink}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Review &amp; publish</h1>
          <PhaseBadge phase={exam.phase} />
        </div>
        <p className="text-lg">{exam.title}</p>
      </header>

      {!isDraft && (
        <Notice tone="info" role="status">
          This exam is already published. There is no unpublish.{" "}
          <Link href={detailHref} className="underline">
            Go to the exam
          </Link>
        </Notice>
      )}

      {publishError && (
        <Notice tone="error" role="alert">
          <p className="font-semibold">{publishError.message}</p>
          {publishError.blockers.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {publishError.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {isDraft && (
        <section aria-labelledby="checks-title" className="flex flex-col gap-3">
          <h2 id="checks-title" className="sr-only">
            Publish checks
          </h2>
          {check.blockers.length > 0 ? (
            <Notice tone="error">
              <p className="font-semibold">Fix these before publishing</p>
              <ul className="mt-1 list-disc pl-5">
                {check.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </Notice>
          ) : (
            <Notice tone="success">
              <p className="font-semibold">✓ Ready to publish</p>
            </Notice>
          )}
          {check.warnings.length > 0 && (
            <Notice tone="warning">
              <p className="font-semibold">Worth a second look</p>
              <ul className="mt-1 list-disc pl-5">
                {check.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Notice>
          )}
        </section>
      )}

      <Card
        title="Settings"
        actions={
          isDraft && (
            <Link href={`${detailHref}?tab=details`} className="text-sm text-blue-700 hover:underline dark:text-blue-300">
              Edit
            </Link>
          )
        }
      >
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Fact label="Opens" value={formatDateTime(exam.startAt)} />
          <Fact label="Closes" value={formatDateTime(exam.endAt)} />
          <Fact label="Duration" value={`${formatDuration(exam.durationMin)} (window ${formatDuration(Math.max(windowMin, 0))})`} />
          <Fact label="Time zone" value={timeZone ?? "Your local time"} />
          <Fact label="Shuffle questions" value={exam.shuffleQuestions ? "Yes" : "No"} />
          <Fact label="Shuffle options" value={exam.shuffleOptions ? "Yes" : "No"} />
          <Fact label="Enrolled candidates" value={exam.enrolledCount} />
        </dl>
        <div className="mt-4 text-sm">
          <p className="text-xs uppercase tracking-wide opacity-60">Instructions</p>
          {exam.instructions.trim() ? (
            <p className="mt-1 whitespace-pre-wrap">{exam.instructions}</p>
          ) : (
            <p className="mt-1 opacity-60">No instructions.</p>
          )}
        </div>
      </Card>

      <Card
        title={`Questions (${exam.questionCount})`}
        actions={
          isDraft && (
            <Link href={`${detailHref}?tab=questions`} className="text-sm text-blue-700 hover:underline dark:text-blue-300">
              Edit
            </Link>
          )
        }
      >
        {exam.questions.length === 0 ? (
          <p className="text-sm opacity-60">No questions assigned.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-120 text-left text-sm">
              <thead className="text-xs uppercase tracking-wide opacity-70">
                <tr>
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Question</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 text-right">Marks</th>
                </tr>
              </thead>
              <tbody>
                {exam.questions.map((question, index) => (
                  <tr key={question.questionId} className="border-t border-black/5 dark:border-white/10">
                    <td className="py-2 pr-3 align-top tabular-nums opacity-70">{index + 1}</td>
                    <td className="py-2 pr-3 align-top">
                      <span className="line-clamp-2">{question.text}</span>
                      <span className="text-xs opacity-60">
                        {question.topic} · {question.difficulty.toLowerCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <span className={typeBadge}>{question.type}</span>
                    </td>
                    <td className="py-2 text-right align-top tabular-nums">{formatMarks(question.marks)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/15 font-semibold dark:border-white/20">
                  <td colSpan={3} className="py-2 pr-3">
                    Total marks{" "}
                    {marksMatch ? (
                      <span className="font-normal text-green-700 dark:text-green-400">✓ matches the exam total</span>
                    ) : (
                      <span className="font-normal text-red-600 dark:text-red-400">
                        ✕ exam total is {formatMarks(exam.totalMarks)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatMarks(marksSum)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {isDraft && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Link href={detailHref} className={secondaryButton}>
            Back
          </Link>
          <button type="button" className={primaryButton} disabled={!check.ready || loading} onClick={() => setConfirmOpen(true)}>
            Publish exam
          </button>
        </div>
      )}

      <ConfirmPublish
        open={confirmOpen}
        title={exam.title}
        summary={`${exam.questionCount} question${exam.questionCount === 1 ? "" : "s"} · ${formatMarks(exam.totalMarks)} marks · opens ${formatDateTime(exam.startAt)}`}
        warningCount={check.warnings.length}
        publishing={publishing}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void publish()}
      />
    </div>
  );
}

function ConfirmPublish({
  open,
  title,
  summary,
  warningCount,
  publishing,
  onCancel,
  onConfirm,
}: Readonly<{
  open: boolean;
  title: string;
  summary: string;
  warningCount: number;
  publishing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      aria-labelledby="confirm-publish-title"
      className="m-auto w-full max-w-md rounded-xl border border-black/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40 dark:border-white/15"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id="confirm-publish-title" className="text-lg font-semibold">
          Publish “{title}”?
        </h2>
        <p className="text-sm opacity-80">{summary}</p>
        <p className="text-sm">
          Enrolled candidates will see the exam. Once anyone starts it, the schedule and questions are locked, and an exam
          can&apos;t be unpublished.
        </p>
        {warningCount > 0 && (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {warningCount} warning{warningCount === 1 ? "" : "s"} still open (see the review page).
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onCancel} disabled={publishing}>
            Cancel
          </button>
          <button type="button" className={primaryButton} onClick={onConfirm} disabled={publishing} autoFocus>
            {publishing ? "Publishing…" : "Publish exam"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
