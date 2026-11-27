type Props = {
  className?: string;
  label?: string;
};

export function Skeleton({ className = "", label = "Loading" }: Readonly<Props>) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-[var(--surface-2)] ${className}`.trim()}
      role="status"
      aria-label={label}
    />
  );
}
