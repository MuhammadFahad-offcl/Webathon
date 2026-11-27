import type { Metadata } from "next";
import { QuestionBank } from "@/components/examiner/questions/question-bank";

export const metadata: Metadata = { title: "Question bank · Examiner" };

// proxy.ts limits /examiner/* to EXAMINER and ADMIN; the /api/questions endpoints enforce ownership.
export default function ExaminerQuestionsPage() {
  return <QuestionBank />;
}
