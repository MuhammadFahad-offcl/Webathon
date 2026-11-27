"use client";

import { useSyncExternalStore } from "react";

/** Date helpers for the examiner exam screens. Dates travel as ISO strings (UTC). */

const pad = (value: number) => String(value).padStart(2, "0");

/** ISO string -> `YYYY-MM-DDTHH:mm` in the browser's time zone, for `<input type="datetime-local">`. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` value (local wall time) -> ISO string; "" stays "" so validation can say "required". */
export function fromLocalInput(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function formatMarks(marks: number) {
  return Number.isInteger(marks) ? String(marks) : marks.toFixed(2).replace(/0$/, "");
}

const noopSubscribe = () => () => {};

/** The browser's IANA time zone (e.g. "Asia/Karachi"); null during server rendering. */
export function useTimeZone() {
  return useSyncExternalStore(
    noopSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  );
}
