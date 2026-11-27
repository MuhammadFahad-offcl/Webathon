import type { ReactNode } from "react";
import { AppShell } from "@/frontend/components/app-shell";

export default function ExaminerLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell role="EXAMINER">{children}</AppShell>;
}
