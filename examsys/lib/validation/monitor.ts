import { z } from "zod";
import type { ExamPhaseName } from "./exams";

/** Shared by the monitor/announcement APIs and the exam "Monitor" tab. */

export const INCIDENT_TYPES = [
  "TAB_HIDDEN",
  "FULLSCREEN_EXIT",
  "PASTE",
  "COPY",
  "DISCONNECT",
  "RECONNECT",
  "LATE_SYNC",
  "OTHER",
] as const;
export type IncidentTypeName = (typeof INCIDENT_TYPES)[number];

/** Newest incidents returned by the monitor (per attempt when `attemptId` is given). */
export const MONITOR_RECENT_INCIDENTS = 50;
export const MONITOR_ATTEMPT_INCIDENTS = 200;
export const ANNOUNCEMENT_MAX_CHARS = 500;

/** GET /api/exams/:id/monitor?type=&attemptId= - both only filter `recentIncidents`. */
export const monitorQuerySchema = z.object({
  type: z.enum(INCIDENT_TYPES).optional(),
  attemptId: z.string().trim().min(1).max(100).optional(),
});
export type MonitorQuery = z.output<typeof monitorQuerySchema>;

/** POST /api/exams/:id/announcements */
export const announcementSchema = z
  .object({
    message: z
      .string({ error: "Message is required" })
      .trim()
      .min(1, "Write a message")
      .max(ANNOUNCEMENT_MAX_CHARS, `At most ${ANNOUNCEMENT_MAX_CHARS} characters`),
  })
  .strict();
export type AnnouncementInput = z.input<typeof announcementSchema>;

/** GET /api/exams/:id/announcements?since=<ISO> */
export const announcementsQuerySchema = z.object({
  since: z.iso.datetime({ offset: true, error: "Must be an ISO date-time" }).optional(),
});

export type MonitorAttemptStatus = "IN_PROGRESS" | "SUBMITTED" | "GRADED";

export type MonitorAttempt = {
  attemptId: string;
  candidate: { id: string; name: string };
  status: MonitorAttemptStatus;
  answered: number;
  total: number;
  lastHeartbeatAt: string | null;
  incidentCount: number;
  lateSyncCount: number;
  startedAt: string;
  expiresAt: string;
  submittedAt: string | null;
};

export type MonitorIncident = {
  id: string;
  attemptId: string;
  candidateName: string;
  type: IncidentTypeName;
  at: string;
  meta: unknown;
};

export type MonitorResponse = {
  serverNow: string;
  phase: ExamPhaseName;
  counts: { enrolled: number; notStarted: number; inProgress: number; submitted: number };
  attempts: MonitorAttempt[];
  recentIncidents: MonitorIncident[];
};

export type Announcement = { id: string; message: string; at: string };
export type AnnouncementsResponse = { items: Announcement[] };
