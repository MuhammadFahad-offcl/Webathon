import type { ReactNode } from "react";

type Props = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: Readonly<Props>) {
  return (
    <section className="page-surface grid justify-items-center gap-3 px-6 py-12 text-center" aria-label={title}>
      <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-[var(--surface-2)] text-xl">—</span>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="max-w-md text-sm text-muted">{description}</p>
      {action}
    </section>
  );
}
