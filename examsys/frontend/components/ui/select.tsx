import type { SelectHTMLAttributes } from "react";

export function Select({ className = "", ...props }: Readonly<SelectHTMLAttributes<HTMLSelectElement>>) {
  return <select className={`field-control ${className}`.trim()} {...props} />;
}
