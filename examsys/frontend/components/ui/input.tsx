import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: Readonly<InputHTMLAttributes<HTMLInputElement>>) {
  return <input className={`field-control ${className}`.trim()} {...props} />;
}
