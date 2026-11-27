"use client";

import type { ComponentType } from "react";
import { AnalyticsExamTab } from "@/components/examiner/analytics/analytics-tab";
import { MonitorTab } from "@/components/examiner/monitor/monitor-tab";
import type { ExamDetail } from "@/lib/validation/exams";
import { GradingTab } from "@/components/examiner/grading/grading-tab";
import { ResultsTab } from "@/components/examiner/grading/results-tab";
import { CandidatesTabSlot } from "./candidates-tab-slot";
import { DetailsTab } from "./details-tab";
import { QuestionsTab } from "./questions-tab";

/**
 * The tabs of /examiner/exams/[id] (selected with `?tab=<id>`), one component per tab.
 */
export type ExamTabProps = {
  exam: ExamDetail;
  /** Call with the exam returned by a mutation so the header and other tabs update. */
  onExamChange: (exam: ExamDetail) => void;
  /** Re-fetches the exam from GET /api/exams/:id. */
  reload: () => void;
};

export type ExamTab = { id: string; label: string; Component: ComponentType<ExamTabProps> };

function CandidatesTab({ exam }: Readonly<ExamTabProps>) {
  return <CandidatesTabSlot examId={exam.id} />;
}

export const EXAM_TABS: readonly ExamTab[] = [
  { id: "details", label: "Details", Component: DetailsTab },
  { id: "questions", label: "Questions", Component: QuestionsTab },
  { id: "candidates", label: "Candidates", Component: CandidatesTab },
  { id: "monitor", label: "Monitor", Component: MonitorTab },
  { id: "grading", label: "Grading", Component: GradingTab },
  { id: "results", label: "Results", Component: ResultsTab },
  { id: "analytics", label: "Analytics", Component: AnalyticsExamTab },
];

export const DEFAULT_EXAM_TAB = EXAM_TABS[0].id;

export function findExamTab(id: string | null) {
  return EXAM_TABS.find((tab) => tab.id === id) ?? EXAM_TABS[0];
}
