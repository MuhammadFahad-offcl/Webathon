import type { ReactNode } from "react";
import type { ExamPhaseName } from "@/lib/validation/exams";

/** Small presentational pieces shared by the exam screens. */

const phaseStyles: Record<ExamPhaseName, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-800 ring-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600" },
  UPCOMING: { label: "Upcoming", className: "bg-blue-100 text-blue-800 ring-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800" },
  ONGOING: { label: "Ongoing", className: "bg-green-100 text-green-800 ring-green-300 dark:bg-green-950 dark:text-green-200 dark:ring-green-800" },
  COMPLETED: { label: "Completed", className: "bg-purple-100 text-purple-800 ring-purple-300 dark:bg-purple-950 dark:text-purple-200 dark:ring-purple-800" },
  ARCHIVED: { label: "Archived", className: "bg-stone-100 text-stone-700 ring-stone-300 dark:bg-stone-900 dark:text-stone-300 dark:ring-stone-700" },
};

export const phaseLabel = (phase: ExamPhaseName) => phaseStyles[phase].label;

export function PhaseBadge({ phase }: Readonly<{ phase: ExamPhaseName }>) {
  const style = phaseStyles[phase];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.className}`}>
      {phase === "ONGOING" && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {style.label}
    </span>
  );
}

export const typeBadge = "rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-medium tracking-wide dark:bg-white/10";

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: Readonly<{ label: string; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }>) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={htmlFor} className="font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <span id={htmlFor ? `${htmlFor}-error` : undefined} className="text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : (
        hint && <span className="opacity-60">{hint}</span>
      )}
    </div>
  );
}

export function Card({ title, children, actions }: Readonly<{ title?: string; children: ReactNode; actions?: ReactNode }>) {
  return (
    <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const noticeStyles = {
  error: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-900",
  warning: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900",
  info: "bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900",
  success: "bg-green-50 text-green-900 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-900",
};

export function Notice({
  tone,
  children,
  role,
}: Readonly<{ tone: keyof typeof noticeStyles; children: ReactNode; role?: "alert" | "status" }>) {
  return (
    <div role={role} className={`rounded-md border px-4 py-3 text-sm ${noticeStyles[tone]}`}>
      {children}
    </div>
  );
}

export function Fact({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide opacity-60">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
