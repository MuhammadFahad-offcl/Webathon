import type { ReactNode } from "react";
import { AppShell } from "@/frontend/components/app-shell";

export default function CandidateLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell role="CANDIDATE">{children}</AppShell>;
}
