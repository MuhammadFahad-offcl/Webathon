import type { Metadata } from "next";
import { Suspense } from "react";
import { SandboxView } from "@/components/examiner/sandbox/sandbox-view";
import { Skeleton } from "@/frontend/components/ui/skeleton";

export const metadata: Metadata = { title: "Preview as candidate · Examiner" };

/**
 * "Preview as candidate" (sandbox) attempt. The banner is static and stays pinned while the
 * examiner scrolls; the workspace (client, reads the URL params) sits in a Suspense boundary.
 */
export default function SandboxPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div
        role="note"
        aria-label="Sandbox mode"
        className="sticky top-0 z-30 rounded-xl border-2 border-[var(--warning)] bg-[var(--surface)] px-4 py-3 shadow-md"
      >
        <p className="text-sm">
          <strong className="mr-1 font-extrabold tracking-wide text-[var(--warning)]">SANDBOX — not recorded.</strong>
          Candidates never see this attempt and it is excluded from every count, result and report.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <SandboxView />
      </Suspense>
    </div>
  );
}
