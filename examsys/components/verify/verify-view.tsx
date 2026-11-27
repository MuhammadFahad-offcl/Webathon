"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/** Public /verify/[code] page body: asks GET /api/verify/:code and shows the outcome. */

type VerifyResult =
  | { valid: true; examTitle: string; issuedAt: string; candidate: string; scoreBand: "Pass" | "Fail" }
  | { valid: false };

type LoadError = { message: string };

const dateFormat = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });

export function VerifyView() {
  const { code } = useParams<{ code: string }>();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const requestKey = `${code}#${reloadKey}`;
  const loading = settledKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/verify/${encodeURIComponent(code)}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 429) throw new Error("Too many verification requests from your network. Wait a minute and try again.");
        if (!response.ok) throw new Error(`Verification is unavailable right now (${response.status}). Please try again.`);
        return (await response.json()) as VerifyResult;
      })
      .then((body) => {
        if (cancelled) return;
        setResult(body);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult(null);
        setError({
          message: err instanceof TypeError ? "Network error. Check your connection and try again." : err instanceof Error ? err.message : "Verification failed.",
        });
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [code, requestKey]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 sm:py-16">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-700 dark:text-blue-300">
          Secure Examination Management System
        </p>
        <h1 className="text-2xl font-semibold">Result verification</h1>
      </header>

      <section
        aria-live="polite"
        aria-busy={loading}
        className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/15 dark:bg-zinc-900"
      >
        {loading && !error ? (
          <div className="flex items-center gap-3 p-6 text-sm opacity-70">
            <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Checking this verification code…
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 p-6 text-sm">
            <p role="alert" className="text-amber-800 dark:text-amber-200">
              {error.message}
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setReloadKey((key) => key + 1);
              }}
              className="rounded-md border border-black/15 px-4 py-2 font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Try again
            </button>
          </div>
        ) : result?.valid ? (
          <ValidResult result={result} />
        ) : (
          <InvalidResult />
        )}
        <div className="border-t border-black/10 px-6 py-4 text-xs dark:border-white/15">
          <span className="opacity-60">Verification code</span>
          <p className="mt-1 font-mono text-sm break-all">{code}</p>
        </div>
      </section>

      <section className="flex flex-col gap-2 text-sm leading-relaxed opacity-80">
        <h2 className="font-semibold">What does verification mean?</h2>
        <p>
          When results are published, the system issues each candidate a result statement with a unique code and a
          tamper-evident fingerprint of the result (attempt, exam, score and issue date). This page recomputes that
          fingerprint from the live records. <strong>Valid</strong> means the result exists and has not been changed since
          it was issued.
        </p>
        <p>
          To protect the candidate&apos;s privacy, only the exam, the issue date, the candidate&apos;s initials and a
          pass/fail band are shown here. Compare these with the PDF you were given.
        </p>
      </section>
    </div>
  );
}

function ValidResult({ result }: Readonly<{ result: Extract<VerifyResult, { valid: true }> }>) {
  const pass = result.scoreBand === "Pass";
  return (
    <div className="flex flex-col gap-5 p-6">
      <Badge tone="valid" title="Valid result" subtitle="Issued by the examination system and unchanged since." />
      <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <Detail label="Exam" wide>
          <span className="break-words">{result.examTitle}</span>
        </Detail>
        <Detail label="Candidate">{result.candidate}</Detail>
        <Detail label="Issued">{dateFormat(result.issuedAt)}</Detail>
        <Detail label="Result">
          <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
              pass
                ? "bg-green-100 text-green-800 ring-green-300 dark:bg-green-950 dark:text-green-200 dark:ring-green-800"
                : "bg-red-100 text-red-800 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800"
            }`}
          >
            {result.scoreBand}
          </span>
        </Detail>
      </dl>
    </div>
  );
}

function InvalidResult() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Badge tone="invalid" title="Not verified" subtitle="This code does not match a valid, unaltered result." />
      <p className="text-sm opacity-80">
        The code may be mistyped, the report may not exist, or the result record has changed since it was issued. If
        you received this document from a candidate, ask for the original PDF or contact the examination office.
      </p>
    </div>
  );
}

function Badge({ tone, title, subtitle }: Readonly<{ tone: "valid" | "invalid"; title: string; subtitle: string }>) {
  const valid = tone === "valid";
  return (
    <div
      className={`flex items-center gap-4 rounded-xl border p-4 ${
        valid
          ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100"
          : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
      }`}
    >
      <span
        aria-hidden
        className={`flex size-11 shrink-0 items-center justify-center rounded-full text-white ${valid ? "bg-green-600" : "bg-red-600"}`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="size-6">
          {valid ? (
            <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
          ) : (
            <path fillRule="evenodd" d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.58l3.3-3.3a1 1 0 1 1 1.4 1.42L11.42 10l3.3 3.3a1 1 0 0 1-1.42 1.4L10 11.42l-3.3 3.3a1 1 0 0 1-1.4-1.42L8.58 10l-3.3-3.3a1 1 0 0 1 0-1.4Z" clipRule="evenodd" />
          )}
        </svg>
      </span>
      <div className="flex flex-col">
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-sm opacity-80">{subtitle}</p>
      </div>
    </div>
  );
}

function Detail({ label, children, wide }: Readonly<{ label: string; children: ReactNode; wide?: boolean }>) {
  return (
    <div className={`flex flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs uppercase tracking-wide opacity-60">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
