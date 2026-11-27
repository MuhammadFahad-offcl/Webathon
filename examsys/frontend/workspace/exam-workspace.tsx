"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { AUTOSAVE_DEBOUNCE_MS, GRACE_MS, HEARTBEAT_INTERVAL_MS } from "@/lib/constants";
import {
  deleteOutboxItemIfCurrent,
  getAttemptOutbox,
  putOutboxItem,
  type OutboxItem,
} from "@/lib/offline/outbox";
import { mergeOutboxAnswers } from "@/lib/offline/merge";
import { Badge } from "@/frontend/components/ui/badge";
import { Button } from "@/frontend/components/ui/button";
import { Dialog } from "@/frontend/components/ui/dialog";
import { ErrorState } from "@/frontend/components/ui/error-state";
import { Skeleton } from "@/frontend/components/ui/skeleton";
import { QuestionCard } from "@/frontend/workspace/question-card";
import { QuestionPalette } from "@/frontend/workspace/question-palette";
import {
  initialWorkspaceState,
  type Announcement,
  type AnswerResponse,
  type AttemptAnswer,
  type AttemptPayload,
  type CandidateQuestion,
} from "@/frontend/workspace/types";
import { workspaceReducer } from "@/frontend/workspace/workspace-reducer";

type Props = {
  attemptId: string;
  mode?: "live" | "sandbox";
};
type SaveState = "saved" | "saving" | "offline" | "retrying" | "failed";
type ConnectionState = "online" | "unstable" | "offline";
type SaveView = {
  state: SaveState;
  pending: number;
  lastSavedAt: number | null;
};
type ClockAnchor = {
  serverMs: number;
  performanceMs: number;
};
type HeartbeatResponse = {
  serverNow: string;
  expiresAt: string;
  announcements: Announcement[];
};
type SaveResponse = {
  serverNow: string;
  expiresAt: string;
  results: Array<{ questionId: string; status: string }>;
};

const RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000, 15_000];
const EMPTY_SAVE: SaveView = { state: "saved", pending: 0, lastSavedAt: null };

function answerResponse(question: CandidateQuestion): AnswerResponse {
  return question.type === "WRITTEN" ? { text: "" } : { optionIds: [] };
}

function hasResponse(answer: AttemptAnswer | undefined): boolean {
  if (!answer?.response) return false;
  if ("text" in answer.response) return answer.response.text.trim().length > 0;
  return answer.response.optionIds.length > 0;
}

function formatTimer(milliseconds: number): string {
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function estimateServerNow(anchor: ClockAnchor | null, performanceNow: number): number {
  if (!anchor) return 0;
  return anchor.serverMs + Math.max(0, performanceNow - anchor.performanceMs);
}

function syncErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 401) return "Your session expired. Sign in again to continue.";
  if (error instanceof ApiClientError) return error.message;
  return "Could not sync answers. Your local copies are still queued.";
}

export function ExamWorkspace({ attemptId, mode = "live" }: Readonly<Props>) {
  const router = useRouter();
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const [sync, setSync] = useState<SaveView>(EMPTY_SAVE);
  const [connection, setConnection] = useState<ConnectionState>("online");
  const [perfNow, setPerfNow] = useState(0);
  const [clockAnchor, setClockAnchor] = useState<ClockAnchor | null>(null);
  const [writable, setWritable] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [timerAnnouncement, setTimerAnnouncement] = useState("");
  const [timerWarning, setTimerWarning] = useState<string | null>(null);

  const clockRef = useRef<ClockAnchor | null>(null);
  const answersRef = useRef<Record<string, AttemptAnswer>>({});
  const startedAtRef = useRef<string | null>(null);
  const attemptRef = useRef<AttemptPayload["attempt"] | null>(null);
  const writableRef = useRef(false);
  const storageReadyRef = useRef(false);
  const lastAnnouncementAtRef = useRef<string | null>(null);
  const incidentThrottleRef = useRef<Record<string, number>>({});
  const hiddenAtRef = useRef<number | null>(null);
  const flushingRef = useRef(false);
  const flushAgainRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryIndexRef = useRef(0);
  const failedSinceRef = useRef<number | null>(null);
  const requestFailuresRef = useRef(0);
  const rejectedAnswersRef = useRef(false);
  const submitRunningRef = useRef(false);
  const nextAutoSubmitAtRef = useRef(0);
  const autoSubmitRetryIndexRef = useRef(0);
  const lastFinalizationCheckRef = useRef(0);
  const releaseLockRef = useRef<(() => void) | null>(null);
  const warningThresholdRef = useRef<number | null>(null);
  const flushRef = useRef<() => Promise<boolean>>(async () => false);
  const autoSubmitRef = useRef<() => Promise<void>>(async () => undefined);

  const setWritableState = useCallback((value: boolean) => {
    writableRef.current = value;
    setWritable(value);
  }, []);

  const setStorageState = useCallback((value: boolean) => {
    storageReadyRef.current = value;
    setStorageReady(value);
  }, []);

  const calibrateClock = useCallback((serverNow: string, requestStartedAt: number) => {
    const receivedAt = performance.now();
    const serverMs = Date.parse(serverNow);
    if (!Number.isFinite(serverMs)) throw new Error("The server returned an invalid clock value.");
    const anchor = {
      serverMs: serverMs + Math.max(0, receivedAt - requestStartedAt) / 2,
      performanceMs: receivedAt,
    };
    clockRef.current = anchor;
    setClockAnchor(anchor);
    setPerfNow(receivedAt);
  }, []);

  const handleNetworkSuccess = useCallback((elapsedMs: number) => {
    requestFailuresRef.current = 0;
    setConnection(!navigator.onLine ? "offline" : elapsedMs > 3_000 ? "unstable" : "online");
  }, []);

  const navigateTo = useCallback((index: number) => {
    const boundedIndex = Math.min(Math.max(0, index), Math.max(0, state.questions.length - 1));
    dispatch({ type: "NAVIGATE", index: boundedIndex });
    try {
      localStorage.setItem(`examsys.pos.${attemptId}`, String(boundedIndex));
    } catch {
      setNotice("Your current question position could not be saved on this device.");
    }
  }, [attemptId, state.questions.length]);

  const scheduleRetry = useCallback((pending: number) => {
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    const delay = RETRY_DELAYS[Math.min(retryIndexRef.current, RETRY_DELAYS.length - 1)];
    retryIndexRef.current += 1;
    failedSinceRef.current ??= Date.now();
    const isLongFailure = Date.now() - failedSinceRef.current >= 60_000;
    setSync((current) => ({
      state: isLongFailure ? "failed" : navigator.onLine ? "retrying" : "offline",
      pending,
      lastSavedAt: current.lastSavedAt,
    }));
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      void flushRef.current();
    }, delay);
  }, []);

  const flushAnswers = useCallback(async (): Promise<boolean> => {
    if (!attemptId || !storageReadyRef.current || !writableRef.current) return false;
    if (flushingRef.current) {
      flushAgainRef.current = true;
      return false;
    }

    flushingRef.current = true;
    let hadRejectedItem = false;
    let pendingCount = sync.pending;
    try {
      do {
        flushAgainRef.current = false;
        const queued = (await getAttemptOutbox(attemptId)).sort(
          (a, b) => a.seq - b.seq || a.updatedAt - b.updatedAt,
        );
        pendingCount = queued.length;
        if (queued.length === 0) {
          failedSinceRef.current = null;
          retryIndexRef.current = 0;
          requestFailuresRef.current = 0;
          setSync((current) => ({
            ...current,
            state: rejectedAnswersRef.current ? "failed" : navigator.onLine ? "saved" : "offline",
            pending: 0,
            lastSavedAt: current.lastSavedAt,
          }));
          if (navigator.onLine) setConnection("online");
          else setConnection("offline");
          return true;
        }

        if (!navigator.onLine) {
          requestFailuresRef.current += 1;
          setConnection("offline");
          scheduleRetry(queued.length);
          return false;
        }

        setSync((current) => ({ ...current, state: "saving", pending: queued.length }));
        for (let offset = 0; offset < queued.length; offset += 100) {
          const batch = queued.slice(offset, offset + 100);
          const startedAt = performance.now();
          const response = await apiFetch<SaveResponse>(`/api/attempts/${encodeURIComponent(attemptId)}/answers`, {
            method: "PUT",
            body: JSON.stringify({
              items: batch.map(({ questionId, response: answer, flagged, seq, elapsedMs }) => ({
                questionId,
                response: answer,
                flagged,
                seq,
                elapsedMs,
              })),
            }),
          });
          handleNetworkSuccess(performance.now() - startedAt);
          calibrateClock(response.serverNow, startedAt);
          if (attemptRef.current) {
            attemptRef.current = { ...attemptRef.current, expiresAt: response.expiresAt };
          }
          dispatch({ type: "CLOCK_UPDATED", expiresAt: response.expiresAt });

          const resultsByQuestion = new Map(response.results.map((result) => [result.questionId, result]));
          if (resultsByQuestion.size !== batch.length || batch.some((item) => !resultsByQuestion.has(item.questionId))) {
            throw new Error("The server returned an incomplete answer-save response.");
          }
          for (const item of batch) {
            const result = resultsByQuestion.get(item.questionId);
            if (!result) throw new Error("The server returned an incomplete answer-save response.");
            if (result.status === "saved" || result.status === "ignored_stale" ||
                result.status === "rejected_late" || result.status === "rejected_invalid") {
              await deleteOutboxItemIfCurrent(item);
            }
            if (result.status === "rejected_late") {
              hadRejectedItem = true;
              rejectedAnswersRef.current = true;
              setNotice(`Question ${state.questions.findIndex((question) => question.id === item.questionId) + 1} was not saved because the answer arrived after the allowed sync window.`);
            } else if (result.status === "rejected_invalid") {
              hadRejectedItem = true;
              rejectedAnswersRef.current = true;
              setNotice(`Question ${state.questions.findIndex((question) => question.id === item.questionId) + 1} could not be saved. Revisit and check your answer.`);
            } else if (result.status !== "saved" && result.status !== "ignored_stale") {
              throw new Error("The server returned an unexpected answer-save status.");
            }
          }
        }
      } while (flushAgainRef.current || (await getAttemptOutbox(attemptId)).length > 0);

      const remaining = await getAttemptOutbox(attemptId);
      failedSinceRef.current = null;
      retryIndexRef.current = 0;
      const hasRejectedAnswers = rejectedAnswersRef.current || hadRejectedItem;
      setSync({
        state: hasRejectedAnswers ? "failed" : "saved",
        pending: remaining.length,
        lastSavedAt: Date.now(),
      });
      setConnection(navigator.onLine ? "online" : "offline");
      return remaining.length === 0;
    } catch (error) {
      const status = error instanceof ApiClientError ? error.status : 0;
      requestFailuresRef.current += 1;
      setConnection(!navigator.onLine || requestFailuresRef.current > 1 ? "offline" : "unstable");
      setNotice(syncErrorMessage(error));
      if (error instanceof ApiClientError && (status === 0 || status >= 500)) scheduleRetry(pendingCount);
      else {
        failedSinceRef.current ??= Date.now();
        setSync((current) => ({ ...current, state: "failed" }));
      }
      return false;
    } finally {
      flushingRef.current = false;
      if (flushAgainRef.current) {
        flushAgainRef.current = false;
        if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null;
          void flushRef.current();
        }, 0);
      }
    }
  }, [attemptId, calibrateClock, handleNetworkSuccess, scheduleRetry, state.questions, sync.pending]);

  useEffect(() => {
    flushRef.current = flushAnswers;
  }, [flushAnswers]);

  const queueFlush = useCallback((delay = AUTOSAVE_DEBOUNCE_MS) => {
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      void flushRef.current();
    }, delay);
  }, []);

  const reportIncident = useCallback(async (type: "TAB_HIDDEN" | "PASTE" | "COPY" | "OTHER", meta?: Record<string, unknown>) => {
    if (mode === "sandbox") return;
    const now = performance.now();
    if (now - (incidentThrottleRef.current[type] ?? 0) < 1_500) return;
    incidentThrottleRef.current[type] = now;
    try {
      await apiFetch(`/api/attempts/${encodeURIComponent(attemptId)}/incidents`, {
        method: "POST",
        body: JSON.stringify({ type, ...(meta ? { meta } : {}) }),
      });
      setIncidentError(null);
    } catch (error) {
      setIncidentError(error instanceof ApiClientError ? error.message : "An integrity signal could not be recorded.");
    }
  }, [attemptId, mode]);

  const recordAnswer = useCallback(async (question: CandidateQuestion, response: AnswerResponse, flagged?: boolean) => {
    if (!writableRef.current || !storageReadyRef.current) return;
    const current = answersRef.current[question.id];
    const next: AttemptAnswer = {
      response,
      flagged: flagged ?? current?.flagged ?? false,
      seq: (current?.seq ?? 0) + 1,
    };
    answersRef.current = { ...answersRef.current, [question.id]: next };
    dispatch({
      type: flagged === undefined ? "ANSWER_CHANGED" : "FLAG_CHANGED",
      questionId: question.id,
      answer: next,
    });
    setSync((view) => ({ ...view, state: "saving", pending: Math.max(1, view.pending) }));
    setNotice(null);

    const clock = clockRef.current;
    const startedAt = startedAtRef.current;
    if (!clock || !startedAt) {
      setNotice("The server clock is not ready. Your answer has not been queued.");
      return;
    }
    const elapsedMs = Math.max(0, Math.floor(estimateServerNow(clock, performance.now()) - Date.parse(startedAt)));
    const item: OutboxItem = {
      attemptId,
      questionId: question.id,
      response,
      flagged: next.flagged,
      seq: next.seq,
      elapsedMs,
      updatedAt: Date.now(),
    };
    try {
      await putOutboxItem(item);
      const pending = await getAttemptOutbox(attemptId);
      setSync((view) => ({ ...view, state: navigator.onLine ? "saving" : "offline", pending: pending.length }));
      if (!navigator.onLine) setConnection("offline");
      queueFlush();
    } catch (error) {
      setStorageState(false);
      setSync((view) => ({ ...view, state: "failed" }));
      setNotice(error instanceof Error ? error.message : "Could not keep your answer on this device.");
    }
  }, [attemptId, queueFlush, setStorageState]);

  const finalizeOnServer = useCallback(async () => {
    const result = await apiFetch<{ status: string; submittedAt: string | null }>(
      `/api/attempts/${encodeURIComponent(attemptId)}/submit`,
      { method: "POST" },
    );
    attemptRef.current = attemptRef.current
      ? { ...attemptRef.current, status: result.status }
      : null;
    dispatch({ type: "FINALIZED", status: result.status, submittedAt: result.submittedAt });
    setReviewOpen(false);
    setSubmitError(null);
    setSubmitting(false);
  }, [attemptId]);

  const submitAttempt = useCallback(async () => {
    if (submitRunningRef.current) return;
    submitRunningRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const flushed = await flushRef.current();
      if (!flushed) {
        setSubmitError("Answers are still waiting to sync. Reconnect and try submitting again.");
        return;
      }
      const pending = await getAttemptOutbox(attemptId);
      if (pending.length > 0) {
        setSubmitError("Some answers are still pending. Please wait for them to save.");
        return;
      }
      await finalizeOnServer();
    } catch (error) {
      setSubmitError(syncErrorMessage(error));
    } finally {
      submitRunningRef.current = false;
      setSubmitting(false);
    }
  }, [attemptId, finalizeOnServer]);

  const autoSubmit = useCallback(async () => {
    const attempt = attemptRef.current;
    const now = estimateServerNow(clockRef.current, performance.now());
    if (!attempt || attempt.status !== "IN_PROGRESS") return;
    const expiresAt = Date.parse(attempt.expiresAt);
    if (now < expiresAt || submitRunningRef.current) return;

    if (now > expiresAt + GRACE_MS) {
      if (performance.now() - lastFinalizationCheckRef.current < 5_000) return;
      lastFinalizationCheckRef.current = performance.now();
      try {
        const startedAt = performance.now();
        const payload = await apiFetch<AttemptPayload>(`/api/attempts/${encodeURIComponent(attemptId)}`);
        calibrateClock(payload.serverNow, startedAt);
        if (payload.attempt.status !== "IN_PROGRESS") {
          attemptRef.current = payload.attempt;
          dispatch({ type: "FINALIZED", status: payload.attempt.status, submittedAt: null });
        }
      } catch (error) {
        setSubmitError(syncErrorMessage(error));
      }
      return;
    }

    if (performance.now() < nextAutoSubmitAtRef.current) return;
    if (autoSubmitRetryIndexRef.current > 0) {
      const delay = RETRY_DELAYS[Math.min(autoSubmitRetryIndexRef.current - 1, RETRY_DELAYS.length - 1)];
      nextAutoSubmitAtRef.current = performance.now() + delay;
    }
    autoSubmitRetryIndexRef.current += 1;
    submitRunningRef.current = true;
    setSubmitting(true);
    try {
      const flushed = await flushRef.current();
      if (!flushed || (await getAttemptOutbox(attemptId)).length > 0) return;
      await finalizeOnServer();
      autoSubmitRetryIndexRef.current = 0;
      nextAutoSubmitAtRef.current = 0;
    } catch (error) {
      setSubmitError(syncErrorMessage(error));
    } finally {
      submitRunningRef.current = false;
      setSubmitting(false);
    }
  }, [attemptId, calibrateClock, finalizeOnServer]);

  useEffect(() => {
    autoSubmitRef.current = autoSubmit;
  }, [autoSubmit]);

  useEffect(() => {
    if (!attemptId) return;
    const controller = new AbortController();
    async function load() {
      dispatch({ type: "LOAD_STARTED" });
      try {
        const requestStartedAt = performance.now();
        const payload = await apiFetch<AttemptPayload>(`/api/attempts/${encodeURIComponent(attemptId)}`, {
          signal: controller.signal,
        });
        calibrateClock(payload.serverNow, requestStartedAt);
        attemptRef.current = payload.attempt;
        startedAtRef.current = payload.attempt.startedAt;
        rejectedAnswersRef.current = false;
        warningThresholdRef.current = null;
        setTimerAnnouncement("");
        setTimerWarning(null);
        const localItems = await getAttemptOutbox(attemptId);
        const mergedAnswers = mergeOutboxAnswers(payload.answers, localItems);
        answersRef.current = mergedAnswers;
        dispatch({ type: "LOADED", payload: { ...payload, answers: mergedAnswers } });
        setStorageState(true);
        try {
          const storedPosition = Number(localStorage.getItem(`examsys.pos.${attemptId}`));
          if (Number.isInteger(storedPosition) && storedPosition >= 0) {
            dispatch({ type: "NAVIGATE", index: storedPosition });
          }
        } catch {
          setNotice("Your saved question position could not be restored.");
        }
        const announcementTimes = payload.announcements.map((announcement) => announcement.at).sort();
        lastAnnouncementAtRef.current = announcementTimes.at(-1) ?? null;
        const pending = localItems.length;
        const online = navigator.onLine;
        setConnection(online ? "online" : "offline");
        setSync({
          state: pending === 0
            ? online ? "saved" : "offline"
            : payload.attempt.status !== "IN_PROGRESS" ? "failed" : online ? "saving" : "offline",
          pending,
          lastSavedAt: pending === 0 ? null : null,
        });
        if (payload.attempt.status === "IN_PROGRESS" && pending > 0) queueFlush(0);
        if (payload.attempt.status !== "IN_PROGRESS" && pending > 0) {
          setNotice("This attempt is already submitted. Changes not accepted by the server will remain on this device.");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiClientError && error.status === 401) {
          router.replace("/login");
          return;
        }
        dispatch({
          type: "LOAD_FAILED",
          message: error instanceof Error ? error.message : "Could not load this attempt.",
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [attemptId, calibrateClock, loadVersion, queueFlush, router, setStorageState]);

  const activeAttemptId = state.attempt?.id;
  const activeAttemptStatus = state.attempt?.status;

  useEffect(() => {
    const heartbeatAttemptId = activeAttemptId;
    if (!heartbeatAttemptId || activeAttemptStatus !== "IN_PROGRESS") return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      setPerfNow(now);
      void autoSubmitRef.current();
      const currentAttempt = attemptRef.current;
      if (!currentAttempt) return;
      const remaining = Date.parse(currentAttempt.expiresAt) - estimateServerNow(clockRef.current, now);
      const threshold = remaining <= 60_000 ? 60 : remaining <= 300_000 ? 300 : remaining <= 600_000 ? 600 : null;
      if (threshold !== null && (warningThresholdRef.current === null || threshold < warningThresholdRef.current)) {
        const label = threshold === 600 ? "10 minutes" : threshold === 300 ? "5 minutes" : "1 minute";
        warningThresholdRef.current = threshold;
        setTimerAnnouncement(`${label} remaining.`);
        setTimerWarning(`${label} remaining`);
      }
      if (remaining <= 0 && warningThresholdRef.current !== 0) {
        warningThresholdRef.current = 0;
        setTimerAnnouncement("Time is up. Your answers are being synced.");
        setTimerWarning("Time is up. Your answers are being synced.");
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [activeAttemptId, activeAttemptStatus]);

  useEffect(() => {
    const heartbeatAttemptId = activeAttemptId;
    if (!heartbeatAttemptId || activeAttemptStatus !== "IN_PROGRESS") return;
    async function sendHeartbeat() {
      if (!heartbeatAttemptId) return;
      const startedAt = performance.now();
      try {
        const payload = await apiFetch<HeartbeatResponse>(
          `/api/attempts/${encodeURIComponent(heartbeatAttemptId)}/heartbeat`,
          {
            method: "POST",
            body: JSON.stringify(lastAnnouncementAtRef.current
              ? { sinceAnnouncementAt: lastAnnouncementAtRef.current }
              : {}),
          },
        );
        handleNetworkSuccess(performance.now() - startedAt);
        calibrateClock(payload.serverNow, startedAt);
        if (attemptRef.current) {
          attemptRef.current = { ...attemptRef.current, expiresAt: payload.expiresAt };
        }
        dispatch({ type: "CLOCK_UPDATED", expiresAt: payload.expiresAt });
        if (payload.announcements.length > 0) {
          dispatch({ type: "ANNOUNCEMENTS_RECEIVED", announcements: payload.announcements });
          const newest = payload.announcements.map((announcement) => announcement.at).sort().at(-1);
          if (newest) lastAnnouncementAtRef.current = newest;
        }
      } catch (error) {
        requestFailuresRef.current += 1;
        setConnection(!navigator.onLine || requestFailuresRef.current > 1 ? "offline" : "unstable");
        if (error instanceof ApiClientError && error.code === "ATTEMPT_CLOSED") {
          try {
            const requestStartedAt = performance.now();
            const payload = await apiFetch<AttemptPayload>(`/api/attempts/${encodeURIComponent(heartbeatAttemptId)}`);
            calibrateClock(payload.serverNow, requestStartedAt);
            attemptRef.current = payload.attempt;
            if (payload.attempt.status !== "IN_PROGRESS") {
              dispatch({ type: "FINALIZED", status: payload.attempt.status, submittedAt: null });
            }
          } catch (refreshError) {
            setNotice(syncErrorMessage(refreshError));
          }
        }
      }
    }
    const interval = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    const onOnline = () => {
      setConnection("unstable");
      void flushRef.current();
      void sendHeartbeat();
    };
    const onOffline = () => {
      setConnection("offline");
      setSync((current) => ({ ...current, state: current.pending > 0 ? "offline" : current.state }));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void flushRef.current();
        void sendHeartbeat();
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activeAttemptId, activeAttemptStatus, calibrateClock, handleNetworkSuccess]);

  useEffect(() => {
    if (!activeAttemptId || activeAttemptStatus !== "IN_PROGRESS") return;
    const manager = navigator.locks;
    if (!manager) {
      return;
    }
    const controller = new AbortController();
    void manager.request(`examsys-attempt-${activeAttemptId}`, {
      ifAvailable: true,
      signal: controller.signal,
    }, async (lock) => {
      if (!lock) {
        setWritableState(false);
        return;
      }
      await new Promise<void>((resolve) => {
        releaseLockRef.current = resolve;
        setWritableState(true);
        queueFlush(0);
      });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : "Could not lock this attempt in this tab.");
      }
    });
    return () => {
      releaseLockRef.current?.();
      releaseLockRef.current = null;
      controller.abort();
      setWritableState(false);
    };
  }, [activeAttemptId, activeAttemptStatus, queueFlush, setWritableState]);

  useEffect(() => {
    if (!activeAttemptId || activeAttemptStatus !== "IN_PROGRESS") return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [activeAttemptId, activeAttemptStatus]);

  useEffect(() => {
    if (!activeAttemptId || activeAttemptStatus !== "IN_PROGRESS" || mode === "sandbox") return;
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = performance.now();
        return;
      }
      if (hiddenAtRef.current !== null) {
        const durationMs = Math.round(performance.now() - hiddenAtRef.current);
        hiddenAtRef.current = null;
        void reportIncident("TAB_HIDDEN", { durationMs });
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [activeAttemptId, activeAttemptStatus, mode, reportIncident]);

  useEffect(() => {
    if (!activeAttemptId || activeAttemptStatus !== "IN_PROGRESS") return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName)
      )) return;
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "n") {
        event.preventDefault();
        navigateTo(state.currentIndex + 1);
      } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "p") {
        event.preventDefault();
        navigateTo(state.currentIndex - 1);
      } else if (event.key.toLowerCase() === "f" && writableRef.current && storageReadyRef.current) {
        event.preventDefault();
        const question = state.questions[state.currentIndex];
        if (question) {
          const answer = answersRef.current[question.id];
          void recordAnswer(question, answer?.response ?? answerResponse(question), !(answer?.flagged ?? false));
        }
      } else if (/^[1-9]$/.test(event.key) && writableRef.current && storageReadyRef.current) {
        const question = state.questions[state.currentIndex];
        const option = question?.options[Number(event.key) - 1];
        if (question && option && question.type !== "WRITTEN") {
          event.preventDefault();
          const answer = answersRef.current[question.id];
          const currentIds = answer?.response && "optionIds" in answer.response ? answer.response.optionIds : [];
          const isSelected = currentIds.includes(option.id);
          if (question.type === "MCQ") void recordAnswer(question, { optionIds: [option.id] });
          else {
            const ids = new Set(currentIds);
            if (isSelected) ids.delete(option.id);
            else ids.add(option.id);
            void recordAnswer(question, { optionIds: [...ids] });
          }
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeAttemptId, activeAttemptStatus, navigateTo, recordAnswer, state.currentIndex, state.questions]);

  const anchor = clockAnchor;
  const estimatedNow = estimateServerNow(anchor, perfNow);
  const expiresAtMs = state.attempt ? Date.parse(state.attempt.expiresAt) : 0;
  const remainingMs = anchor ? Math.max(0, expiresAtMs - estimatedNow) : state.attempt?.remainingMs ?? 0;
  const expired = Boolean(state.attempt && anchor && estimatedNow >= expiresAtMs);
  const locked = Boolean(state.attempt && (state.attempt.status !== "IN_PROGRESS" || expired));
  const inGrace = Boolean(state.attempt && expired && estimatedNow <= expiresAtMs + GRACE_MS);
  const currentQuestion = state.questions[state.currentIndex] ?? null;
  const answeredCount = useMemo(
    () => state.questions.filter((question) => hasResponse(state.answers[question.id])).length,
    [state.answers, state.questions],
  );
  const flaggedCount = useMemo(
    () => state.questions.filter((question) => state.answers[question.id]?.flagged).length,
    [state.answers, state.questions],
  );
  const unansweredQuestions = state.questions.filter((question) => !hasResponse(state.answers[question.id]));
  const flaggedQuestions = state.questions.filter((question) => state.answers[question.id]?.flagged);
  const canEdit = writable && storageReady && !locked;

  function answerChanged(question: CandidateQuestion, response: AnswerResponse) {
    void recordAnswer(question, response);
  }

  function flagChanged(question: CandidateQuestion) {
    const current = answersRef.current[question.id];
    void recordAnswer(question, current?.response ?? answerResponse(question), !(current?.flagged ?? false));
  }

  function jumpTo(index: number) {
    navigateTo(index);
    setReviewOpen(false);
  }

  function renderSaveStatus() {
    const labels: Record<SaveState, string> = {
      saved: "Saved",
      saving: "Saving…",
      offline: "Offline · saved on this device",
      retrying: `Retrying (${sync.pending} pending)`,
      failed: "Sync failed · tell the invigilator",
    };
    return (
      <div className={`workspace-save-status ${sync.state}`} role="status" aria-live="polite">
        <span aria-hidden="true">{sync.state === "saved" ? "✓" : sync.state === "saving" ? "…" : "●"}</span>
        <span>{labels[sync.state]}</span>
        {sync.state === "saved" && sync.lastSavedAt !== null && (
          <span className="text-xs text-muted">
            Last saved {new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(sync.lastSavedAt)}
          </span>
        )}
      </div>
    );
  }

  if (state.loading) {
    return (
      <main className="workspace-loading" role="status" aria-label="Loading exam">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-72 w-full" />
      </main>
    );
  }

  if (state.error || !state.attempt || !state.exam) {
    return (
      <main className="workspace-loading">
        <ErrorState
          title="Exam could not be loaded"
          description={state.error ?? "The attempt data is incomplete."}
          action={<button className="button-secondary" type="button" onClick={() => setLoadVersion((version) => version + 1)}>Try again</button>}
        />
      </main>
    );
  }

  if (state.attempt.status !== "IN_PROGRESS") {
    return (
      <main className="workspace-finished">
        {mode === "sandbox" && <Badge tone="warning">SANDBOX · not recorded</Badge>}
        <section className="page-surface grid justify-items-center gap-4 p-8 text-center">
          <Badge tone="success">{state.attempt.status === "GRADED" ? "Graded" : "Submitted"}</Badge>
          <h1 className="text-3xl font-bold">{state.exam.title}</h1>
          <p className="text-muted">Your attempt has been submitted. Results will be available when they are published.</p>
          {notice && <p className="workspace-notice" role="alert">{notice}</p>}
          {sync.pending > 0 && (
            <p className="workspace-notice" role="alert">
              {sync.pending} local answer{sync.pending === 1 ? "" : "s"} could not be synced before this attempt was submitted.
            </p>
          )}
          <Link className="button-primary" href="/dashboard">Back to my exams</Link>
        </section>
      </main>
    );
  }

  const readOnlyMessage = !writable
    ? typeof navigator !== "undefined" && "locks" in navigator && Boolean(navigator.locks)
      ? "This exam is open in another tab. This tab is read-only."
      : "This browser cannot lock an attempt to one tab. Use a supported browser to answer safely."
    : !storageReady
      ? "Local answer storage is unavailable. Answers are disabled until storage can be restored."
      : null;

  return (
    <div className="exam-workspace">
      {mode === "sandbox" && <div className="sandbox-banner">SANDBOX · not recorded · practice only</div>}
      <a className="skip-link" href="#question-content">Skip to current question</a>
      <header className="workspace-header">
        <div className="workspace-heading">
          <Link href="/dashboard" className="workspace-brand" aria-label="ExamSys home">EX</Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{state.exam.title}</p>
            <p className="text-xs text-muted">{state.questions.length} questions · {state.exam.totalMarks} marks</p>
          </div>
        </div>
        <div className="workspace-header-actions">
          <div className={`workspace-timer ${expired ? "expired" : remainingMs <= 300_000 ? "warning" : ""}`}>
            <span className="text-xs font-bold uppercase tracking-wide">Time left</span>
            <time className="font-mono text-xl font-bold tabular-nums" aria-label={`${formatTimer(remainingMs)} remaining`}>
              {formatTimer(remainingMs)}
            </time>
          </div>
          {renderSaveStatus()}
          <button className="button-primary" type="button" onClick={() => setReviewOpen(true)} disabled={state.attempt.status !== "IN_PROGRESS"}>
            Review & submit
          </button>
        </div>
      </header>

      <main className="workspace-main">
        {connection !== "online" && (
          <div className={`workspace-connection ${connection}`} role="status" aria-live="polite">
            {connection === "offline"
              ? "Offline · The timer keeps running. Answers are queued on this device and will sync when connected."
              : "Connection unstable · Keep this page open while answers sync."}
          </div>
        )}
        {readOnlyMessage && <p className="workspace-readonly" role="alert">{readOnlyMessage}</p>}
        {inGrace && (
          <p className="workspace-grace" role="status">
            Time has ended. Inputs are locked; queued answers can still sync during the 2-minute grace period.
          </p>
        )}
        {notice && <p className="workspace-notice" role="status">{notice}</p>}
        {incidentError && <p className="workspace-notice" role="status">{incidentError}</p>}
        {state.announcements.map((announcement) => (
          <aside className="workspace-announcement" key={announcement.id} aria-label="Exam announcement">
            <p><strong>Examiner announcement</strong> · {announcement.message}</p>
            <button type="button" onClick={() => dispatch({ type: "ANNOUNCEMENT_DISMISSED", id: announcement.id })} aria-label="Dismiss announcement">
              Dismiss
            </button>
          </aside>
        ))}
        <p className="sr-only" aria-live="polite" aria-atomic="true">{timerAnnouncement}</p>
        {timerWarning && <p className="workspace-timer-warning" role="status">{timerWarning}</p>}

        <div className="workspace-grid">
          <div className="workspace-question-column" id="question-content">
            {currentQuestion && (
              <QuestionCard
                question={currentQuestion}
                answer={state.answers[currentQuestion.id]}
                questionIndex={state.currentIndex}
                totalQuestions={state.questions.length}
                locked={locked}
                readOnly={!canEdit}
                onAnswer={(response) => answerChanged(currentQuestion, response)}
                onFlag={() => flagChanged(currentQuestion)}
                onCopyOrPaste={(type) => void reportIncident(type)}
                onPrevious={() => navigateTo(state.currentIndex - 1)}
                onNext={() => navigateTo(state.currentIndex + 1)}
              />
            )}
          </div>
          <aside className="workspace-sidebar">
            <QuestionPalette
              questions={state.questions}
              answers={state.answers}
              currentIndex={state.currentIndex}
              onSelect={jumpTo}
            />
            <section className="workspace-shortcuts page-surface">
              <h2 className="font-bold">Keyboard shortcuts</h2>
              <ul className="mt-3 grid gap-2 text-sm text-muted">
                <li><kbd>←</kbd> / <kbd>P</kbd> Previous · <kbd>→</kbd> / <kbd>N</kbd> Next</li>
                <li><kbd>F</kbd> Mark for review</li>
                <li><kbd>1–9</kbd> Select an option</li>
              </ul>
            </section>
          </aside>
        </div>
      </main>

      <Dialog open={reviewOpen} title="Review your answers" onClose={() => setReviewOpen(false)}>
        <div className="grid gap-4">
          <p className="text-sm text-muted">
            {answeredCount} answered · {unansweredQuestions.length} unanswered · {flaggedCount} marked for review
          </p>
          {unansweredQuestions.length > 0 && (
            <section>
              <h3 className="font-bold">Unanswered</h3>
              <ul className="mt-2 grid gap-2">
                {unansweredQuestions.map((question) => {
                  const index = state.questions.findIndex((item) => item.id === question.id);
                  return (
                    <li key={question.id}>
                      <button className="text-left text-[var(--brand)] underline" type="button" onClick={() => jumpTo(index)}>
                        Question {index + 1}: {question.text.slice(0, 100)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {flaggedQuestions.length > 0 && (
            <section>
              <h3 className="font-bold">Marked for review</h3>
              <ul className="mt-2 grid gap-2">
                {flaggedQuestions.map((question) => {
                  const index = state.questions.findIndex((item) => item.id === question.id);
                  return (
                    <li key={question.id}>
                      <button className="text-left text-[var(--brand)] underline" type="button" onClick={() => jumpTo(index)}>
                        Question {index + 1}: {question.text.slice(0, 100)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {submitError && <p className="text-sm text-[var(--danger)]" role="alert">{submitError}</p>}
          <p className="rounded-lg bg-[var(--surface-2)] p-3 text-sm">
            Submitting ends your attempt. You cannot change answers after submission.
          </p>
          <Button type="button" onClick={() => void submitAttempt()} disabled={submitting || !canEdit}>
            {submitting ? "Syncing and submitting…" : "Submit exam"}
          </Button>
          {locked && <p className="text-sm text-muted">The timer has ended. Waiting for pending answers to sync.</p>}
        </div>
      </Dialog>

      <footer className="workspace-footer">
        <span>Answered {answeredCount}/{state.questions.length}</span>
        <span>{connection === "offline" ? "Timer keeps running offline" : "Your progress is saved as you work"}</span>
        {mode === "sandbox" && <span>Sandbox attempt</span>}
      </footer>
    </div>
  );
}
