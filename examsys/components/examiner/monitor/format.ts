import { DISCONNECT_GAP_MS } from "@/lib/constants";
import type { IncidentTypeName, MonitorAttempt } from "@/lib/validation/monitor";

/** Labels and time helpers for the Monitor tab. */

export const incidentLabel: Record<IncidentTypeName, string> = {
  TAB_HIDDEN: "Tab hidden",
  FULLSCREEN_EXIT: "Left fullscreen",
  PASTE: "Paste",
  COPY: "Copy",
  DISCONNECT: "Disconnected",
  RECONNECT: "Reconnected",
  LATE_SYNC: "Late sync",
  OTHER: "Other",
};

/** "just now", "12s ago", "3 min ago", "2 h ago". */
export function formatAgo(ms: number) {
  if (ms < 5_000) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export type Presence = "online" | "stale" | "never" | "done";

/**
 * Where a candidate stands, judged on the server's clock (`serverNowMs`):
 * online = heartbeat within DISCONNECT_GAP_MS, stale = older, never = no heartbeat yet.
 */
export function presenceOf(attempt: MonitorAttempt, serverNowMs: number): Presence {
  if (attempt.status !== "IN_PROGRESS") return "done";
  if (!attempt.lastHeartbeatAt) return "never";
  return serverNowMs - Date.parse(attempt.lastHeartbeatAt) < DISCONNECT_GAP_MS ? "online" : "stale";
}

/** Short, readable summary of an incident's `meta` (e.g. "durationMs: 4200"). */
export function describeMeta(meta: unknown) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  return Object.entries(meta as Record<string, unknown>)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
}
