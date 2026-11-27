import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyView } from "@/components/verify/verify-view";

export const metadata: Metadata = {
  title: "Verify result",
  description: "Check that an examination result statement is authentic and unchanged.",
  robots: { index: false, follow: false },
};

// Public page (proxy.ts does not match /verify). The client view reads the code from the URL.
export default function VerifyPage() {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<p className="px-4 py-10 text-center text-sm opacity-60">Checking verification code…</p>}>
        <VerifyView />
      </Suspense>
    </main>
  );
}
