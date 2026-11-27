"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { EmptyState } from "@/frontend/components/ui/empty-state";
import { ErrorState } from "@/frontend/components/ui/error-state";
import { PageHeader } from "@/frontend/components/ui/page-header";
import { Skeleton } from "@/frontend/components/ui/skeleton";
import { ExamCard } from "@/frontend/candidate/exam-card";
import type { CandidateExamGroups } from "@/frontend/candidate/exam-types";

const sections = [
  { key: "available", title: "Available now", empty: "No exams are open right now." },
  { key: "upcoming", title: "Upcoming", empty: "You have no upcoming exams." },
  { key: "completed", title: "Completed", empty: "Completed exams and results will appear here." },
] as const;

function LoadingCards() {
  return (
    <div className="candidate-exam-grid" role="status" aria-label="Loading exams">
      {[0, 1, 2].map((item) => (
        <div key={item} className="page-surface grid gap-4 p-5">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-12 w-full" />
        </div>
      ))}
    </div>
  );
}

export function CandidateDashboard() {
  const router = useRouter();
  const [groups, setGroups] = useState<CandidateExamGroups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const updateTime = () => setNow(Date.now());
    const initialTimer = window.setTimeout(updateTime, 0);
    const timer = window.setInterval(updateTime, 30_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<CandidateExamGroups>("/api/candidate/exams", { signal: controller.signal })
      .then((result) => {
        setGroups(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiClientError && cause.status === 401) {
          router.replace("/login");
          return;
        }
        setError(cause instanceof ApiClientError ? cause.message : "Could not load your exams.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, router]);

  function retry() {
    setError(null);
    setLoading(true);
    setReload((value) => value + 1);
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        <ErrorState
          title="Your exams could not be loaded"
          description={error}
          action={<button className="button-secondary" type="button" onClick={retry}>Try again</button>}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="My exams"
        description="Review your exam schedule and continue an in-progress attempt."
      />
      {loading || !groups ? (
        <LoadingCards />
      ) : (
        <div className="grid gap-10">
          {sections.map(({ key, title, empty }) => {
            const exams = groups[key];
            return (
              <section key={key} aria-labelledby={`candidate-section-${key}`}>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h2 className="text-xl font-bold" id={`candidate-section-${key}`}>{title}</h2>
                  <span className="text-sm text-muted">{exams.length} {exams.length === 1 ? "exam" : "exams"}</span>
                </div>
                {exams.length ? (
                  <div className="candidate-exam-grid">
                    {exams.map((exam) => <ExamCard key={exam.examId} exam={exam} now={now} />)}
                  </div>
                ) : (
                  <EmptyState title={empty} description="Check back later for updates from your examiner." />
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
