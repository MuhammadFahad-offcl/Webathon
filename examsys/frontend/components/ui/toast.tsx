"use client";

import { useEffect } from "react";

type Props = {
  message: string;
  tone?: "success" | "error" | "info";
  onClose: () => void;
};

const toneColor = {
  success: "var(--success)",
  error: "var(--danger)",
  info: "var(--info)",
} as const;

export function Toast({ message, tone = "info", onClose }: Readonly<Props>) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex max-w-[min(26rem,calc(100vw-2rem))] items-start gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
      role={tone === "error" ? "alert" : "status"}
      style={{ borderInlineStartWidth: "4px", borderInlineStartColor: toneColor[tone] }}
    >
      <p className="text-sm font-semibold">{message}</p>
      <button className="shrink-0 underline" type="button" onClick={onClose} aria-label="Dismiss notification">Dismiss</button>
    </div>
  );
}
