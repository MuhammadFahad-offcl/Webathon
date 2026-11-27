import type { ReactNode } from "react";

type Props = {
  title?: string;
  description: string;
  action?: ReactNode;
};

export function ErrorState({ title = "Something went wrong", description, action }: Readonly<Props>) {
  return (
    <section className="page-surface grid gap-3 border-l-4 border-l-[var(--danger)] p-5" role="alert">
      <h2 className="font-bold">{title}</h2>
      <p className="text-sm text-muted">{description}</p>
      {action}
    </section>
  );
}
