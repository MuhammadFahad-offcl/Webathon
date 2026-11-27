"use client";

import { useEffect, useRef } from "react";
import { primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Small native <dialog> confirm (Esc and the Cancel button close it). */
export function ConfirmDialog({ open, title, message, confirmLabel, busy, onConfirm, onClose }: Readonly<Props>) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      className="m-auto w-full max-w-sm rounded-xl border border-black/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40 dark:border-white/15"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id="confirm-dialog-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="text-sm opacity-80">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onClose} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className={`${primaryButton} bg-red-600 hover:bg-red-700`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
