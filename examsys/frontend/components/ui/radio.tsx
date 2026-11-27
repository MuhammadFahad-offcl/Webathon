import type { InputHTMLAttributes } from "react";

export function Radio({ className = "", ...props }: Readonly<Omit<InputHTMLAttributes<HTMLInputElement>, "type">>) {
  return (
    <input
      className={`size-4 accent-[var(--brand)] ${className}`.trim()}
      {...props}
      type="radio"
    />
  );
}
