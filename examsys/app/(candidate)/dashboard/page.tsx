import type { Metadata } from "next";
import { CandidateDashboard } from "@/frontend/candidate/candidate-dashboard";

export const metadata: Metadata = { title: "My exams" };

export default function CandidateDashboardPage() {
  return <CandidateDashboard />;
}
