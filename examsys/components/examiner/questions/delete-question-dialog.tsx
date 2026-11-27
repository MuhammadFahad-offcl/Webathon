"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import type { QuestionDto } from "@/lib/validation/questions";
import { primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";

type Props = {
  question: QuestionDto | null;
  onClose: () => void;
  onDeleted: (question: QuestionDto) => void;
  onDuplicate: (question: QuestionDto) => void;
};

type UsedIn = { id: string; title: string }[];

/** Confirms a delete; when the question is in use, shows which exams and offers Duplicate. */
export function DeleteQuestionDialog({ question, onClose, onDeleted, onDuplicate }: Readonly<Props>) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (question && !dialog.open) dialog.showModal();
    else if (!question && dialog.open) dialog.close();
  }, [question]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="delete-question-title"
      className="m-auto w-full max-w-md rounded-xl border border-black/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40 dark:border-white/15"
    >
      {question && (
        <DeleteBody
          key={question.id}
          question={question}
          onClose={onClose}
          onDeleted={onDeleted}
          onDuplicate={onDuplicate}
        />
      )}
    </dialog>
  );
}

function DeleteBody({ question, onClose, onDeleted, onDuplicate }: Readonly<Props & { question: QuestionDto }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedIn, setUsedIn] = useState<UsedIn | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/questions/${question.id}`, { method: "DELETE" });
      onDeleted(question);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409 && Array.isArray(err.details?.exams)) {
        setUsedIn(err.details.exams as UsedIn);
        setError(err.message);
      } else {
        setError(err instanceof ApiClientError ? err.message : "Delete failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 id="delete-question-title" className="text-lg font-semibold">
        {usedIn ? "Question is in use" : "Delete question?"}
      </h2>
      <p className="line-clamp-3 rounded-md bg-black/3 px-3 py-2 text-sm dark:bg-white/5">{question.text}</p>

      {!usedIn && !error && (
        <p className="text-sm opacity-80">This permanently removes the question and its options from your bank.</p>
      )}

      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
          <p>{error}</p>
          {usedIn && (
            <ul className="list-disc pl-5">
              {usedIn.map((exam) => (
                <li key={exam.id}>
                  <Link href={`/examiner/exams/${exam.id}`} className="underline">
                    {exam.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryButton} autoFocus>
          {usedIn ? "Close" : "Cancel"}
        </button>
        {usedIn ? (
          <button type="button" className={primaryButton} onClick={() => onDuplicate(question)}>
            Duplicate instead
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}
