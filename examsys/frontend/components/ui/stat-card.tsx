import type { ReactNode } from "react";

type Props = {
  label: string;
  value: ReactNode;
  detail?: string;
};

export function StatCard({ label, value, detail }: Readonly<Props>) {
  return (
    <section className="page-surface p-5" aria-label={label}>
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
      {detail && <p className="mt-1 text-sm text-muted">{detail}</p>}
    </section>
  );
}
