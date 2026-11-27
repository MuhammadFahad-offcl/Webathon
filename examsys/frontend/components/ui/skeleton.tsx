type Props = {
  className?: string;
};

export function Skeleton({ className = "" }: Readonly<Props>) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-[var(--surface-2)] ${className}`.trim()}
      aria-hidden="true"
    />
  );
}
