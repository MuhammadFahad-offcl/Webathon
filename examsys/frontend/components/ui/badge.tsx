import type { HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
};

export function Badge({ tone = "neutral", className = "", ...props }: Readonly<Props>) {
  return <span className={`status-badge ${className}`.trim()} data-tone={tone} {...props} />;
}
