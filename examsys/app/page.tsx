import { Suspense } from "react";
import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/guards";

async function RoleHome(): Promise<never> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === Role.ADMIN) redirect("/admin/users");
  if (session.role === Role.EXAMINER) redirect("/examiner/exams");
  redirect("/dashboard");
}

export default function Home() {
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted">Loading ExamSys…</main>}>
      <RoleHome />
    </Suspense>
  );
}
