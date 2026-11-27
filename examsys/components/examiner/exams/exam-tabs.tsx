"use client";

import type { ComponentType } from "react";
import { MonitorTab } from "@/components/examiner/monitor/monitor-tab";
import type { ExamDetail } from "@/lib/validation/exams";
import { CandidatesTabSlot } from "./candidates-tab-slot";
import { DetailsTab } from "./details-tab";
import { QuestionsTab } from "./questions-tab";
import { Card } from "./ui";

/**
 * The tabs of /examiner/exams/[id] (selected with `?tab=<id>`). Later PRs plug their
 * component in here: replace the `Component` of the matching entry.
 */
export type ExamTabProps = {
  exam: ExamDetail;
  /** Call with the exam returned by a mutation so the header and other tabs update. */
  onExamChange: (exam: ExamDetail) => void;
  /** Re-fetches the exam from GET /api/exams/:id. */
  reload: () => void;
};

export type ExamTab = { id: string; label: string; Component: ComponentType<ExamTabProps> };

function comingSoon(label: string): ComponentType<ExamTabProps> {
  function ComingSoon() {
    return (
      <Card title={label}>
        <p className="text-sm opacity-70">Coming in a later PR.</p>
      </Card>
    );
  }
  ComingSoon.displayName = `ComingSoon(${label})`;
  return ComingSoon;
}

function CandidatesTab({ exam }: Readonly<ExamTabProps>) {
  return <CandidatesTabSlot examId={exam.id} />;
}

export const EXAM_TABS: readonly ExamTab[] = [
  { id: "details", label: "Details", Component: DetailsTab },
  { id: "questions", label: "Questions", Component: QuestionsTab },
  { id: "candidates", label: "Candidates", Component: CandidatesTab },
  { id: "monitor", label: "Monitor", Component: MonitorTab },
  { id: "grading", label: "Grading", Component: comingSoon("Grading") },
  { id: "results", label: "Results", Component: comingSoon("Results") },
  { id: "analytics", label: "Analytics", Component: comingSoon("Analytics") },
];

export const DEFAULT_EXAM_TAB = EXAM_TABS[0].id;

export function findExamTab(id: string | null) {
  return EXAM_TABS.find((tab) => tab.id === id) ?? EXAM_TABS[0];
}
