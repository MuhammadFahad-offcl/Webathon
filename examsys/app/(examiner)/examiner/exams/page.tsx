import type { Metadata } from "next";
import { ExamsList } from "@/components/examiner/exams/exams-list";

export const metadata: Metadata = { title: "Exams · Examiner" };

// proxy.ts limits /examiner to EXAMINER/ADMIN; the /api/exams endpoints enforce ownership.
export default function ExamsPage() {
  return <ExamsList />;
}
