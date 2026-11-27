import type { EnrollmentStatus } from "@/lib/validation/enrollments";

const styles: Record<EnrollmentStatus, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  IN_PROGRESS: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  SUBMITTED: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  GRADED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
};

export const statusLabel: Record<EnrollmentStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  GRADED: "Graded",
};

export function EnrollmentStatusBadge({ status }: Readonly<{ status: EnrollmentStatus }>) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${styles[status]}`}>
      {statusLabel[status]}
    </span>
  );
}
