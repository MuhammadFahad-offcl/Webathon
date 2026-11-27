import type { Metadata } from "next";
import { NewExam } from "@/components/examiner/exams/new-exam";

export const metadata: Metadata = { title: "New exam · Examiner" };

export default function NewExamPage() {
  return <NewExam />;
}
