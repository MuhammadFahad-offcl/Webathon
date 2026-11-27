"use client";

import { useMemo, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { MAX_QUESTION_MARKS, type ExamDetail, type ExamQuestionDto } from "@/lib/validation/exams";
import { inputClass, primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";
import { formatMarks } from "./format";
import { QuestionPicker, type PickedQuestion } from "./question-picker";
import { Card, Notice, typeBadge } from "./ui";
import type { ExamTabProps } from "./exam-tabs";

type Row = Omit<ExamQuestionDto, "order" | "marks"> & { marks: string };

const toRows = (exam: ExamDetail): Row[] => exam.questions.map((q) => ({ ...q, marks: String(q.marks) }));

const TYPE_LABEL: Record<Row["type"], string> = { MCQ: "MCQ", MULTI: "Multi", WRITTEN: "Written" };

function marksError(value: string) {
  const marks = Number(value);
  if (value.trim() === "" || !Number.isFinite(marks)) return "Enter the marks";
  if (marks <= 0) return "Must be greater than 0";
  if (marks > MAX_QUESTION_MARKS) return `At most ${MAX_QUESTION_MARKS}`;
  return null;
}

/** Assigned questions: marks, reorder, remove, add from bank, then Save (PUT replaces the list). */
export function QuestionsTab({ exam, onExamChange }: Readonly<ExamTabProps>) {
  const [rows, setRows] = useState<Row[]>(() => toRows(exam));
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const locked = exam.locked;

  const assignedIds = useMemo(() => new Set(rows.map((row) => row.questionId)), [rows]);
  const total = rows.reduce((sum, row) => sum + (marksError(row.marks) ? 0 : Number(row.marks)), 0);
  const hasInvalid = rows.some((row) => marksError(row.marks));

  function update(next: Row[]) {
    setRows(next);
    setDirty(true);
    setErrors({});
    setMessage(null);
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  }

  function add(picked: PickedQuestion[]) {
    const fresh = picked.filter((q) => !assignedIds.has(q.questionId));
    update([...rows, ...fresh.map((q) => ({ ...q, marks: String(q.marks) }))]);
    setPickerOpen(false);
  }

  async function save() {
    if (hasInvalid) {
      setMessage({ tone: "error", text: "Fix the highlighted marks before saving." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const items = rows.map((row, index) => ({ questionId: row.questionId, marks: Number(row.marks), order: index + 1 }));
      const result = await apiFetch<{ exam: ExamDetail }>(`/api/exams/${exam.id}/questions`, {
        method: "PUT",
        body: JSON.stringify({ items }),
      });
      setRows(toRows(result.exam));
      setDirty(false);
      setErrors({});
      setMessage({ tone: "success", text: `Saved ${result.exam.questionCount} questions · ${formatMarks(result.exam.totalMarks)} marks.` });
      onExamChange(result.exam);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.fields);
        setMessage({ tone: "error", text: error.fields.items ?? error.message });
      } else {
        setMessage({ tone: "error", text: "Something went wrong" });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Questions"
      actions={
        !locked && (
          <button type="button" className={secondaryButton} onClick={() => setPickerOpen(true)}>
            + Add from bank
          </button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {locked && (
          <Notice tone="warning" role="status">
            {exam.lockReason} The question list can no longer be changed.
          </Notice>
        )}
        {message && (
          <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
          </Notice>
        )}

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-black/15 py-12 text-sm dark:border-white/20">
            <span className="opacity-70">No questions yet.</span>
            {!locked && (
              <button type="button" className={primaryButton} onClick={() => setPickerOpen(true)}>
                Add questions from the bank
              </button>
            )}
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {rows.map((row, index) => {
              const error = marksError(row.marks) ?? errors[`items.${index}.marks`] ?? errors[`items.${index}.questionId`];
              return (
                <li
                  key={row.questionId}
                  className="flex flex-wrap items-start gap-3 rounded-lg border border-black/10 px-3 py-2.5 text-sm dark:border-white/15 sm:flex-nowrap"
                >
                  <span className="w-6 shrink-0 pt-1 text-right font-semibold tabular-nums opacity-60">{index + 1}.</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="line-clamp-2">{row.text}</span>
                    <span className="flex flex-wrap gap-1.5 text-xs opacity-80">
                      <span className={typeBadge}>{TYPE_LABEL[row.type]}</span>
                      <span className={typeBadge}>{row.topic}</span>
                      <span className={typeBadge}>{row.difficulty.toLowerCase()}</span>
                      {row.type !== "WRITTEN" && <span>{row.optionCount} options</span>}
                    </span>
                  </div>
                  <div className="flex w-28 shrink-0 flex-col gap-0.5">
                    <label htmlFor={`exam-marks-${row.questionId}`} className="sr-only">
                      Marks for question {index + 1}
                    </label>
                    <input
                      id={`exam-marks-${row.questionId}`}
                      type="number"
                      min={0.25}
                      step={0.25}
                      max={MAX_QUESTION_MARKS}
                      className={`${inputClass} py-1`}
                      value={row.marks}
                      disabled={locked}
                      aria-invalid={Boolean(error)}
                      onChange={(e) => update(rows.map((r, i) => (i === index ? { ...r, marks: e.target.value } : r)))}
                    />
                    {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : <span className="text-xs opacity-60">marks</span>}
                  </div>
                  {!locked && (
                    <div className="flex shrink-0 gap-1">
                      <IconButton label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                        ↑
                      </IconButton>
                      <IconButton
                        label={`Move question ${index + 1} down`}
                        disabled={index === rows.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </IconButton>
                      <IconButton label={`Remove question ${index + 1}`} onClick={() => update(rows.filter((_, i) => i !== index))} danger>
                        ✕
                      </IconButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-4 dark:border-white/15">
          <p className="text-sm" aria-live="polite">
            <span className="font-semibold">{rows.length}</span> question{rows.length === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold">{formatMarks(Math.round(total * 100) / 100)}</span> total marks
            {dirty && <span className="ml-2 text-amber-700 dark:text-amber-400">· unsaved changes</span>}
          </p>
          {!locked && (
            <div className="flex gap-2">
              {dirty && (
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => {
                    setRows(toRows(exam));
                    setDirty(false);
                    setErrors({});
                    setMessage(null);
                  }}
                >
                  Discard
                </button>
              )}
              <button type="button" className={primaryButton} disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save questions"}
              </button>
            </div>
          )}
        </div>
      </div>

      <QuestionPicker open={pickerOpen} assignedIds={assignedIds} onClose={() => setPickerOpen(false)} onAdd={add} />
    </Card>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: Readonly<{ label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-8 items-center justify-center rounded-md border border-black/15 text-sm hover:bg-black/5 disabled:opacity-30 dark:border-white/20 dark:hover:bg-white/10 ${
        danger ? "text-red-600 dark:text-red-400" : ""
      }`}
    >
      {children}
    </button>
  );
}
