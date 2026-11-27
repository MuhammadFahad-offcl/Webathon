"use client";

import { useEffect, useState, type FormEvent } from "react";
import { inputClass, primaryButton } from "@/components/examiner/users/user-dialog";
import { Card } from "@/components/examiner/exams/ui";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { ANNOUNCEMENT_MAX_CHARS, type Announcement, type AnnouncementsResponse } from "@/lib/validation/monitor";
import { formatTime } from "./format";

type Props = {
  examId: string;
  /** Null when posting is allowed, otherwise why it isn't. */
  closedReason: string | null;
};

/** Composer + the announcements already sent (newest first). Candidates get them via heartbeat. */
export function AnnouncementsPanel({ examId, closedReason }: Readonly<Props>) {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AnnouncementsResponse>(`/api/exams/${examId}/announcements`)
      .then((body) => {
        if (cancelled) return;
        setItems(body.items);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof ApiClientError ? err.message : "Could not load announcements");
      });
    return () => {
      cancelled = true;
    };
  }, [examId, reloadKey]);

  useEffect(() => {
    if (!sentNote) return;
    const timer = setTimeout(() => setSentNote(null), 3000);
    return () => clearTimeout(timer);
  }, [sentNote]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setFieldError(null);
    setSendError(null);
    if (!message.trim()) {
      setFieldError("Write a message");
      return;
    }
    setSending(true);
    try {
      const body = await apiFetch<{ announcement: Announcement }>(`/api/exams/${examId}/announcements`, {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setItems((current) => [...(current ?? []), body.announcement]);
      setMessage("");
      setSentNote("Announcement sent. Candidates see it within about 15 seconds.");
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.fields.message) setFieldError(err.fields.message);
        else setSendError(err.message);
      } else setSendError("Could not send the announcement");
    } finally {
      setSending(false);
    }
  }

  const newestFirst = items ? [...items].reverse() : null;
  const remaining = ANNOUNCEMENT_MAX_CHARS - message.length;

  return (
    <Card title="Announcements">
      {closedReason ? (
        <p className="mb-4 text-sm opacity-70">{closedReason}</p>
      ) : (
        <form onSubmit={(event) => void send(event)} className="mb-5 flex flex-col gap-2" noValidate>
          <label htmlFor="announcement-message" className="text-sm font-medium">
            Message to all candidates
          </label>
          <textarea
            id="announcement-message"
            className={`${inputClass} min-h-20 text-sm`}
            value={message}
            maxLength={ANNOUNCEMENT_MAX_CHARS}
            onChange={(event) => setMessage(event.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby="announcement-message-hint"
            placeholder="e.g. Ten minutes remaining"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span id="announcement-message-hint" className={fieldError ? "text-red-600 dark:text-red-400" : "opacity-60"}>
              {fieldError ?? `${remaining} characters left`}
            </span>
            <button type="submit" className={primaryButton} disabled={sending}>
              {sending ? "Sending…" : "Send announcement"}
            </button>
          </div>
          {sendError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {sendError}
            </p>
          )}
          <p role="status" className="text-sm text-green-700 dark:text-green-400">
            {sentNote}
          </p>
        </form>
      )}

      <h3 className="mb-2 text-sm font-semibold">Sent</h3>
      {loadError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {loadError}{" "}
          <button type="button" className="underline" onClick={() => setReloadKey((key) => key + 1)}>
            Retry
          </button>
        </p>
      )}
      {!newestFirst && !loadError && <p className="text-sm opacity-60">Loading…</p>}
      {newestFirst?.length === 0 && <p className="text-sm opacity-60">No announcements yet.</p>}
      {newestFirst && newestFirst.length > 0 && (
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {newestFirst.map((item) => (
            <li key={item.id} className="rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/15">
              <p className="break-words whitespace-pre-wrap">{item.message}</p>
              <time dateTime={item.at} className="text-xs tabular-nums opacity-60">
                {formatTime(item.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
