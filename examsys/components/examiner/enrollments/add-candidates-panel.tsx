"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { inputClass, primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import {
  ENROLL_MAX_ENTRIES,
  parseEmailList,
  type CandidateLookupItem,
  type EnrollResult,
} from "@/lib/validation/enrollments";

type Props = {
  examId: string;
  onClose: () => void;
  /** Called after a successful add so the enrolled list can refresh. */
  onAdded: () => void;
};

type Summary = { kind: "result"; result: EnrollResult } | { kind: "error"; message: string };

export function AddCandidatesPanel({ examId, onClose, onAdded }: Readonly<Props>) {
  const ids = useId();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<CandidateLookupItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, CandidateLookupItem>>(new Map());
  const [emailText, setEmailText] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [saving, setSaving] = useState<"ids" | "emails" | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ examId, limit: "50" });
    if (debounced) params.set("search", debounced);
    return params.toString();
  }, [examId, debounced]);
  const requestKey = `${query}#${reloadKey}`;
  const searching = settledKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: CandidateLookupItem[] }>(`/api/candidates?${query}`)
      .then((body) => {
        if (cancelled) return;
        setResults(body.items);
        setSearchError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSearchError(err instanceof ApiClientError ? err.message : "Could not search candidates");
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  function toggle(candidate: CandidateLookupItem) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.set(candidate.id, candidate);
      return next;
    });
  }

  async function submit(kind: "ids" | "emails") {
    const values = kind === "ids" ? [...selected.keys()] : parseEmailList(emailText);
    const body = kind === "ids" ? { userIds: values } : { emails: values };
    const count = values.length;
    if (count === 0) {
      setFieldErrors(kind === "ids" ? { userIds: "Select at least one candidate" } : { emails: "Enter at least one email" });
      return;
    }
    if (count > ENROLL_MAX_ENTRIES) {
      setFieldErrors({ [kind === "ids" ? "userIds" : "emails"]: `At most ${ENROLL_MAX_ENTRIES} at a time` });
      return;
    }
    setFieldErrors({});
    setSummary(null);
    setSaving(kind);
    try {
      const result = await apiFetch<EnrollResult>(`/api/exams/${examId}/enrollments`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSummary({ kind: "result", result });
      if (kind === "ids") setSelected(new Map());
      else setEmailText("");
      setReloadKey((key) => key + 1);
      onAdded();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fields);
        setSummary({ kind: "error", message: err.message });
      } else {
        setSummary({ kind: "error", message: "Something went wrong" });
      }
    } finally {
      setSaving(null);
    }
  }

  const emailCount = parseEmailList(emailText).length;

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-4 rounded-xl border border-black/10 p-4 dark:border-white/15"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={`${ids}-title`} className="text-base font-semibold">
          Add candidates
        </h3>
        <button type="button" className={secondaryButton} onClick={onClose}>
          Done
        </button>
      </div>

      {summary && <SummaryMessage summary={summary} />}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-search`} className="text-sm font-medium">
            Search candidates
          </label>
          <input
            id={`${ids}-search`}
            type="search"
            className={inputClass}
            placeholder="Name, email or roll no."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {searchError ? (
            <div role="alert" className="flex items-center justify-between rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
              {searchError}
              <button type="button" className="underline" onClick={() => setReloadKey((key) => key + 1)}>
                Retry
              </button>
            </div>
          ) : (
            <fieldset
              aria-busy={searching}
              className="max-h-72 overflow-y-auto rounded-md border border-black/10 dark:border-white/15"
            >
              <legend className="sr-only">Search results</legend>
              {results === null && <p className="px-3 py-6 text-center text-sm opacity-60">Searching…</p>}
              {results?.length === 0 && (
                <p className="px-3 py-6 text-center text-sm opacity-60">
                  {debounced ? "No active candidates match this search." : "No active candidates yet."}
                </p>
              )}
              {results?.map((candidate) => {
                const checked = candidate.enrolled || selected.has(candidate.id);
                return (
                  <label
                    key={candidate.id}
                    className={`flex items-start gap-3 border-t border-black/5 px-3 py-2 text-sm first:border-t-0 dark:border-white/10 ${
                      candidate.enrolled ? "opacity-60" : "cursor-pointer hover:bg-black/3 dark:hover:bg-white/5"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      disabled={candidate.enrolled}
                      onChange={() => toggle(candidate)}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">
                        {candidate.name}
                        {candidate.enrolled && <span className="ml-2 text-xs font-normal">(already enrolled)</span>}
                      </span>
                      <span className="truncate opacity-70">
                        {candidate.email}
                        {candidate.rollNo ? ` · ${candidate.rollNo}` : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {results?.length === 50 && (
            <p className="text-xs opacity-60">Showing the first 50 matches. Refine the search to find others.</p>
          )}
          {fieldErrors.userIds && <p className="text-sm text-red-600 dark:text-red-400">{fieldErrors.userIds}</p>}
          <div>
            <button
              type="button"
              className={primaryButton}
              disabled={saving !== null || selected.size === 0}
              onClick={() => void submit("ids")}
            >
              {saving === "ids" ? "Adding…" : `Add selected (${selected.size})`}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-emails`} className="text-sm font-medium">
            Or paste emails (comma or newline separated)
          </label>
          <textarea
            id={`${ids}-emails`}
            className={`${inputClass} min-h-40 font-mono text-sm`}
            placeholder={"ali@example.com\nsara@example.com"}
            value={emailText}
            aria-invalid={fieldErrors.emails ? true : undefined}
            aria-describedby={`${ids}-emails-hint`}
            onChange={(e) => setEmailText(e.target.value)}
          />
          <p id={`${ids}-emails-hint`} className={`text-sm ${fieldErrors.emails ? "text-red-600 dark:text-red-400" : "opacity-60"}`}>
            {fieldErrors.emails ?? `${emailCount} email${emailCount === 1 ? "" : "s"}. Only active candidate accounts can be enrolled.`}
          </p>
          <div>
            <button
              type="button"
              className={primaryButton}
              disabled={saving !== null || emailCount === 0}
              onClick={() => void submit("emails")}
            >
              {saving === "emails" ? "Adding…" : "Add emails"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryMessage({ summary }: Readonly<{ summary: Summary }>) {
  if (summary.kind === "error") {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
        {summary.message}
      </p>
    );
  }
  const { added, alreadyEnrolled, rejected } = summary.result;
  const tone = rejected.length
    ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200";
  return (
    <div role="status" className={`rounded-md px-3 py-2 text-sm ${tone}`}>
      <p>
        {added} added, {alreadyEnrolled} already enrolled, {rejected.length} rejected
        {rejected.length === 1 && `: ${rejected[0].value} — ${rejected[0].reason}`}
      </p>
      {rejected.length > 1 && (
        <ul className="mt-1 list-disc pl-5">
          {rejected.map((item) => (
            <li key={item.value}>
              {item.value} — {item.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
