"use client";

import { useState } from "react";
import { secondaryButton } from "@/components/examiner/users/user-dialog";

/**
 * "Download PDF" buttons for result statements and exam summaries. They fetch the PDF
 * (so errors like "Publish results first" can be shown inline instead of a broken
 * download), then save it through a temporary object URL.
 */

type ButtonProps = { label?: string; className?: string };

/** Result statement for one attempt: GET /api/reports/:attemptId/pdf. */
export function DownloadReportButton({ attemptId, label = "Download PDF", className }: Readonly<ButtonProps & { attemptId: string }>) {
  return (
    <PdfDownloadButton
      url={`/api/reports/${encodeURIComponent(attemptId)}/pdf`}
      fallbackName={`result-${attemptId}.pdf`}
      label={label}
      className={className}
    />
  );
}

/** Exam summary (stats, distribution, ranking): GET /api/exams/:id/report/pdf. */
export function DownloadExamReportButton({ examId, label = "Exam report (PDF)", className }: Readonly<ButtonProps & { examId: string }>) {
  return (
    <PdfDownloadButton
      url={`/api/exams/${encodeURIComponent(examId)}/report/pdf`}
      fallbackName={`exam-report-${examId}.pdf`}
      label={label}
      className={className}
    />
  );
}

function filenameFrom(disposition: string | null) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1];
}

async function errorMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // Not JSON: fall through to a generic message.
  }
  return `Download failed (${response.status})`;
}

function PdfDownloadButton({ url, fallbackName, label, className }: Readonly<{ url: string; fallbackName: string; label: string; className?: string }>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      let response: Response;
      try {
        response = await fetch(url, { credentials: "same-origin" });
      } catch {
        throw new Error("Network error. Check your connection and retry.");
      }
      if (!response.ok) throw new Error(await errorMessage(response));
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filenameFrom(response.headers.get("content-disposition")) ?? fallbackName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Could not download the PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={download}
        disabled={loading}
        aria-busy={loading}
        className={`inline-flex items-center gap-2 ${className ?? secondaryButton}`}
      >
        <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="size-4 opacity-80">
          <path d="M10 2.5a.75.75 0 0 1 .75.75v7.69l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3.75 3.75a.75.75 0 0 1-1.06 0L5.72 9.53a.75.75 0 0 1 1.06-1.06l2.47 2.47V3.25A.75.75 0 0 1 10 2.5ZM3.5 13.25a.75.75 0 0 1 .75.75v1.25c0 .41.34.75.75.75h10a.75.75 0 0 0 .75-.75V14a.75.75 0 0 1 1.5 0v1.25a2.25 2.25 0 0 1-2.25 2.25H5a2.25 2.25 0 0 1-2.25-2.25V14a.75.75 0 0 1 .75-.75Z" />
        </svg>
        {loading ? "Preparing PDF…" : label}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </span>
  );
}
