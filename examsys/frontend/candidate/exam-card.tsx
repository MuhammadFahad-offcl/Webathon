import Link from "next/link";
import { Badge } from "@/frontend/components/ui/badge";
import { formatDateTime, formatOpensIn } from "@/frontend/candidate/exam-time";
import type { CandidateExam } from "@/frontend/candidate/exam-types";

type Props = {
  exam: CandidateExam;
  now: number;
};

const accessContent: Record<CandidateExam["accessStatus"], { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  UPCOMING: { label: "Upcoming", tone: "warning" },
  OPEN: { label: "Open now", tone: "success" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  SUBMITTED: { label: "Awaiting results", tone: "neutral" },
  RESULT_PUBLISHED: { label: "Result published", tone: "success" },
  MISSED: { label: "Missed", tone: "neutral" },
};

function formatPhase(phase: string): string {
  return phase.charAt(0) + phase.slice(1).toLowerCase().replaceAll("_", " ");
}

function Action({ exam, now }: Props) {
  if (exam.accessStatus === "OPEN") {
    return (
      <Link className="button-primary" href={`/dashboard/exams/${encodeURIComponent(exam.examId)}`}>
        Read instructions
      </Link>
    );
  }
  if (exam.accessStatus === "IN_PROGRESS" && exam.attemptId) {
    return <Link className="button-primary" href={`/exam/${encodeURIComponent(exam.attemptId)}`}>Resume exam</Link>;
  }
  if (exam.accessStatus === "RESULT_PUBLISHED" && exam.attemptId) {
    return <Link className="button-secondary" href={`/results/${encodeURIComponent(exam.attemptId)}`}>View result</Link>;
  }
  if (exam.accessStatus === "UPCOMING") {
    return (
      <div className="grid justify-items-start gap-1">
        <button className="button-secondary" type="button" disabled>
          Not open yet
        </button>
        <span className="text-xs text-muted">{formatOpensIn(exam.startAt, now)}</span>
      </div>
    );
  }
  if (exam.accessStatus === "IN_PROGRESS") {
    return <p className="text-sm text-[var(--warning)]">Your attempt is in progress, but its resume link is unavailable.</p>;
  }
  return null;
}

export function ExamCard({ exam, now }: Readonly<Props>) {
  const status = accessContent[exam.accessStatus];
  return (
    <article className="candidate-exam-card page-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold leading-snug">{exam.title}</h3>
          <p className="mt-1 text-sm text-muted">
            {formatDateTime(exam.startAt)} – {formatDateTime(exam.endAt)}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <p className="line-clamp-2 min-h-10 text-sm text-muted">
        {exam.instructions || "No additional instructions provided."}
      </p>

      <dl className="candidate-exam-facts">
        <div>
          <dt>Duration</dt>
          <dd>{exam.durationMin} min</dd>
        </div>
        <div>
          <dt>Total marks</dt>
          <dd>{exam.totalMarks}</dd>
        </div>
        <div>
          <dt>Closes</dt>
          <dd>{formatDateTime(exam.endAt)}</dd>
        </div>
      </dl>

      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{formatPhase(exam.phase)}</span>
        <Action exam={exam} now={now} />
      </div>
    </article>
  );
}
