"use client";

import Papa from "papaparse";
import { useEffect, useId, useRef, useState } from "react";
import { primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";
import { ApiClientError } from "@/lib/client/api";
import {
  CANDIDATE_COLUMNS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  QUESTION_COLUMNS,
  type ImportKind,
  type ImportReport,
  type ImportRowStatus,
} from "@/lib/validation/import";

type Props = {
  kind: ImportKind;
  /** Candidates only: enroll the imported users into this exam. */
  examId?: string;
  onClose: () => void;
  /** Called once after a real import that created at least one row. */
  onImported: (report: ImportReport) => void;
};

type Stage = "pick" | "preview" | "done";

const COPY: Record<ImportKind, { title: string; noun: string; template: string; columns: readonly string[] }> = {
  candidates: {
    title: "Import candidates",
    noun: "candidate",
    template: "/templates/candidates-sample.csv",
    columns: CANDIDATE_COLUMNS,
  },
  questions: {
    title: "Import questions",
    noun: "question",
    template: "/templates/questions-sample.csv",
    columns: QUESTION_COLUMNS,
  },
};

const MAX_MB = Math.round(IMPORT_MAX_BYTES / (1024 * 1024));
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Uploads the file as multipart/form-data (apiFetch always sends JSON, so this mirrors its error handling). */
async function uploadFile(kind: ImportKind, file: File, dryRun: boolean, examId?: string): Promise<ImportReport> {
  const form = new FormData();
  form.append("file", file);
  if (examId) form.append("examId", examId);
  let response: Response;
  try {
    response = await fetch(`/api/import/${kind}${dryRun ? "?dryRun=true" : ""}`, { method: "POST", body: form });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "Network error. Check your connection and retry.");
  }
  const text = await response.text();
  let body: { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? `Upload failed (${response.status})`,
      body?.error?.fields ?? {},
    );
  }
  return body as ImportReport;
}

function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Reusable bulk-import dialog (native <dialog>): pick or drop a .csv/.json file ->
 * server-side dry run -> per-row preview -> confirm -> summary with downloadable
 * error report (and, for candidates, the generated credentials).
 * Render it only while open (`{open && <ImportDialog … />}`): each mount starts fresh.
 */
export function ImportDialog({ kind, examId, onClose, onImported }: Readonly<Props>) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [stage, setStage] = useState<Stage>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [onlyInvalid, setOnlyInvalid] = useState(false);
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const copy = COPY[kind];

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function choose(next: File | undefined) {
    if (!next || busy) return;
    setError(null);
    const name = next.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".json")) {
      setError("Choose a .csv or .json file.");
      return;
    }
    if (next.size > IMPORT_MAX_BYTES) {
      setError(`This file is larger than ${MAX_MB} MB.`);
      return;
    }
    setFile(next);
    setBusy(true);
    try {
      setPreview(await uploadFile(kind, next, true, examId));
      setOnlyInvalid(false);
      setStage("preview");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not read the file");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function confirmImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const report = await uploadFile(kind, file, false, examId);
      setResult(report);
      setStage("done");
      if (report.imported > 0) onImported(report);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function backToPick() {
    setStage("pick");
    setPreview(null);
    setFile(null);
    setError(null);
  }

  function downloadErrors(report: ImportReport) {
    const rows = report.rows
      .filter((row) => row.status === "invalid")
      .map((row) => [row.row, row.label, row.errors.join("; ")]);
    download(`${kind}-import-errors.csv`, `${Papa.unparse({ fields: ["row", "summary", "errors"], data: rows })}\n`);
  }

  /** Never lose generated passwords (or an import in flight) to a stray Esc / close click. */
  const canClose = () =>
    !busy &&
    (!result?.credentialsCsv ||
      credentialsSaved ||
      window.confirm("The generated passwords have not been downloaded and can't be shown again. Close anyway?"));
  const requestClose = () => {
    if (canClose()) onClose();
  };

  const report = stage === "done" ? result : preview;
  const shownRows = report ? (onlyInvalid ? report.rows.filter((row) => row.status === "invalid") : report.rows) : [];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(event) => {
        if (!canClose()) event.preventDefault();
      }}
      aria-labelledby={titleId}
      className="m-auto w-full max-w-3xl rounded-xl border border-black/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40 dark:border-white/15"
    >
      <div className="flex max-h-[85vh] flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              {copy.title}
            </h2>
            <p className="text-sm opacity-70">
              {stage === "pick" && `Upload a CSV or JSON file (up to ${MAX_MB} MB, ${IMPORT_MAX_ROWS} rows).`}
              {stage === "preview" && `Check the rows below, then import the valid ones.`}
              {stage === "done" && "Import finished."}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="rounded-md px-2 py-1 text-xl leading-none opacity-70 hover:opacity-100 disabled:opacity-30"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        {stage === "pick" && (
          <>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void choose(event.dataTransfer.files[0]);
              }}
              className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center text-sm ${
                dragging ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40" : "border-black/15 dark:border-white/20"
              }`}
            >
              {busy ? (
                <p role="status">Checking {file?.name ?? "the file"}…</p>
              ) : (
                <>
                  <p className="font-medium">Drop a .csv or .json file here</p>
                  <p className="opacity-60">or</p>
                  <label className={`${primaryButton} cursor-pointer focus-within:ring-2 focus-within:ring-blue-600/40`}>
                    Choose file
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".csv,.json,text/csv,application/json"
                      className="sr-only"
                      onChange={(event) => void choose(event.target.files?.[0])}
                    />
                  </label>
                </>
              )}
            </div>
            <div className="text-sm">
              <p className="opacity-80">
                Columns: <code className="break-all text-xs">{copy.columns.join(",")}</code>
              </p>
              {kind === "candidates" && (
                <p className="mt-1 opacity-70">
                  Leave <code>password</code> empty to generate one; you can download the generated passwords once after the import.
                  {examId && " Imported candidates are enrolled in this exam."}
                </p>
              )}
              {kind === "questions" && (
                <p className="mt-1 opacity-70">
                  <code>type</code> is MCQ, MULTI or WRITTEN; <code>correct</code> lists option letters such as <code>B</code> or{" "}
                  <code>A;C</code>. Written questions have no options.
                </p>
              )}
              <a href={copy.template} download className="mt-2 inline-block text-blue-600 hover:underline dark:text-blue-400">
                Download sample CSV
              </a>
            </div>
          </>
        )}

        {report && stage !== "pick" && (
          <>
            {stage === "done" ? (
              <DoneSummary report={report} kind={kind} />
            ) : (
              <p className="text-sm" role="status">
                <strong>{plural(report.total, "row")}</strong> in {file?.name}:{" "}
                <span className="text-green-700 dark:text-green-400">{report.valid} valid</span>,{" "}
                <span className={report.invalid ? "text-red-700 dark:text-red-400" : undefined}>{report.invalid} invalid</span>
              </p>
            )}

            {report.invalid > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={onlyInvalid} onChange={(event) => setOnlyInvalid(event.target.checked)} />
                Show only rows with problems
              </label>
            )}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-black/10 dark:border-white/15">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Rows in the file and their status</caption>
                <thead className="sticky top-0 bg-background text-xs uppercase tracking-wide">
                  <tr className="border-b border-black/10 dark:border-white/15">
                    <th scope="col" className="px-3 py-2">Row</th>
                    <th scope="col" className="px-3 py-2">Status</th>
                    <th scope="col" className="px-3 py-2">{kind === "candidates" ? "Candidate" : "Question"}</th>
                    <th scope="col" className="px-3 py-2">Problems</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((row) => (
                    <tr key={row.row} className="border-t border-black/5 align-top dark:border-white/10">
                      <td className="px-3 py-2 tabular-nums">{row.row}</td>
                      <td className="px-3 py-2">
                        <RowBadge status={row.status} />
                      </td>
                      <td className="max-w-64 px-3 py-2 break-words">{row.label || <span className="opacity-50">—</span>}</td>
                      <td className="px-3 py-2 text-red-700 dark:text-red-300">
                        {row.errors.length > 0 && (
                          <ul className="list-inside list-disc">
                            {row.errors.map((message) => (
                              <li key={message}>{message}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {stage === "preview" && preview && (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondaryButton} onClick={backToPick} disabled={busy}>
              Choose another file
            </button>
            <button type="button" className={primaryButton} onClick={() => void confirmImport()} disabled={busy || preview.valid === 0}>
              {busy ? "Importing…" : `Import ${plural(preview.valid, "valid row")}`}
            </button>
          </div>
        )}

        {stage === "done" && result && (
          <div className="flex flex-col gap-3">
            {result.credentialsCsv && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Generated passwords are shown only now. Download them before closing this dialog.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {result.invalid > 0 && (
                <button type="button" className={secondaryButton} onClick={() => downloadErrors(result)}>
                  Download error report
                </button>
              )}
              {result.credentialsCsv && (
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => {
                    download("candidate-credentials.csv", result.credentialsCsv!);
                    setCredentialsSaved(true);
                  }}
                >
                  {credentialsSaved ? "Download credentials again" : "Download credentials"}
                </button>
              )}
              <button type="button" className={primaryButton} onClick={requestClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

function DoneSummary({ report, kind }: Readonly<{ report: ImportReport; kind: ImportKind }>) {
  return (
    <div role="status" className="flex flex-col gap-1 text-sm">
      <p className="text-base font-medium">
        {report.imported} imported, {report.invalid} failed
      </p>
      {report.imported === 0 && <p className="opacity-70">No {COPY[kind].noun}s were added.</p>}
      {report.enrollment && (
        <p className="opacity-80">
          {plural(report.enrollment.added, "candidate")} enrolled in this exam.
          {report.enrollment.rejected.length > 0 &&
            ` Not enrolled: ${report.enrollment.rejected.map((item) => item.reason).join("; ")}`}
        </p>
      )}
    </div>
  );
}

const BADGE: Record<ImportRowStatus, { label: string; className: string }> = {
  valid: { label: "Valid", className: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200" },
  imported: { label: "Imported", className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200" },
  invalid: { label: "Invalid", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
};

function RowBadge({ status }: Readonly<{ status: ImportRowStatus }>) {
  const badge = BADGE[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${badge.className}`}>{badge.label}</span>;
}
