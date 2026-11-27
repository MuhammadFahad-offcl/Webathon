import type { ComponentPropsWithoutRef } from "react";

export function Table({ className = "", ...props }: Readonly<ComponentPropsWithoutRef<"table">>) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className={`w-full border-collapse text-left text-sm ${className}`.trim()} {...props} />
    </div>
  );
}

export function TableHead(props: Readonly<ComponentPropsWithoutRef<"thead">>) {
  return <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide" {...props} />;
}

export function TableBody(props: Readonly<ComponentPropsWithoutRef<"tbody">>) {
  return <tbody className="divide-y divide-[var(--border)]" {...props} />;
}

export function TableRow(props: Readonly<ComponentPropsWithoutRef<"tr">>) {
  return <tr className="hover:bg-[var(--surface-2)]" {...props} />;
}

export function TableHeaderCell(props: Readonly<ComponentPropsWithoutRef<"th">>) {
  return <th scope="col" className="px-4 py-3 font-bold" {...props} />;
}

export function TableCell(props: Readonly<ComponentPropsWithoutRef<"td">>) {
  return <td className="px-4 py-3" {...props} />;
}
