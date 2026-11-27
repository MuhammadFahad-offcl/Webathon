import { Suspense } from "react";
import { StaffNav, StaffNavFallback } from "@/components/examiner/staff-nav";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* cacheComponents: the nav reads the URL, so it renders inside Suspense. */}
      <Suspense fallback={<StaffNavFallback />}>
        <StaffNav />
      </Suspense>
      <main className="flex flex-1 flex-col">{children}</main>
    </>
  );
}
