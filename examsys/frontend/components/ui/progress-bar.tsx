type Props = {
  value: number;
  label: string;
};

export function ProgressBar({ value, label }: Readonly<Props>) {
  const boundedValue = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={boundedValue}
    >
      <div className="h-full rounded-full bg-[var(--brand)] transition-[width]" style={{ width: `${boundedValue}%` }} />
    </div>
  );
}
