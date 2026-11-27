import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({ variant = "primary", type = "button", className = "", ...props }: Readonly<Props>) {
  return <button type={type} className={`button-${variant} ${className}`.trim()} {...props} />;
}
