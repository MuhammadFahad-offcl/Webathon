import type { ReactNode } from "react";
import { AppShell } from "@/frontend/components/app-shell";

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell role="ADMIN">{children}</AppShell>;
}
