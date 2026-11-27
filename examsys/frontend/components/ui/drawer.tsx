"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function Drawer({ open, title, onClose, children }: Readonly<Props>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="drawer-dialog fixed inset-y-0 right-0 m-0 h-full max-h-none w-[min(26rem,90vw)] border-0 border-l border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--text)] shadow-2xl backdrop:bg-black/50"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <section className="grid h-full content-start gap-5 overflow-y-auto p-6">
        <header className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold" id={titleId}>{title}</h2>
          <button type="button" className="button-secondary min-h-0 px-3 py-1" onClick={onClose} aria-label="Close panel">
            Close
          </button>
        </header>
        {children}
      </section>
    </dialog>
  );
}
