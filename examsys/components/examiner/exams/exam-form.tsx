"use client";

import { useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { zodFieldMap } from "@/lib/validation/fields";
import {
  ALWAYS_EDITABLE_FIELDS,
  START_IN_PAST_MESSAGE,
  createExamSchema,
  updateExamSchema,
  windowMinutes,
  type ExamDetail,
} from "@/lib/validation/exams";
import { inputClass, primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";
import { formatDuration, fromLocalInput, toLocalInput, useTimeZone } from "./format";
import { Field, Notice } from "./ui";

type FormState = {
  title: string;
  instructions: string;
  startAt: string; // datetime-local value
  endAt: string;
  durationMin: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
};

type Props = {
  /** null = create a new exam */
  exam: ExamDetail | null;
  onSaved: (exam: ExamDetail) => void;
  onCancel?: () => void;
};

function initialState(exam: ExamDetail | null): FormState {
  if (!exam) {
    return { title: "", instructions: "", startAt: "", endAt: "", durationMin: "60", shuffleQuestions: false, shuffleOptions: false };
  }
  return {
    title: exam.title,
    instructions: exam.instructions,
    startAt: toLocalInput(exam.startAt),
    endAt: toLocalInput(exam.endAt),
    durationMin: String(exam.durationMin),
    shuffleQuestions: exam.shuffleQuestions,
    shuffleOptions: exam.shuffleOptions,
  };
}

function toBody(form: FormState) {
  return {
    title: form.title,
    instructions: form.instructions,
    startAt: fromLocalInput(form.startAt),
    endAt: fromLocalInput(form.endAt),
    durationMin: form.durationMin.trim() === "" ? Number.NaN : Number(form.durationMin),
    shuffleQuestions: form.shuffleQuestions,
    shuffleOptions: form.shuffleOptions,
  };
}

/** Create / edit form for an exam's settings. When the exam is locked only title + instructions are editable. */
export function ExamForm({ exam, onSaved, onCancel }: Readonly<Props>) {
  const isEdit = exam !== null;
  const locked = exam?.locked ?? false;
  const [form, setForm] = useState<FormState>(() => initialState(exam));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const timeZone = useTimeZone();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setErrors((current) => {
      const { [key]: _removed, ...rest } = current; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    });
  };

  const startDate = form.startAt ? new Date(form.startAt) : null;
  const endDate = form.endAt ? new Date(form.endAt) : null;
  const windowMin = startDate && endDate && endDate > startDate ? windowMinutes(startDate, endDate) : null;

  /** Edit: only the fields that differ from the saved exam, so a locked exam accepts title-only saves. */
  function changedBody() {
    const body = toBody(form);
    const original = toBody(initialState(exam));
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(body) as (keyof typeof body)[]) {
      if (locked && !(ALWAYS_EDITABLE_FIELDS as readonly string[]).includes(key)) continue;
      if (!Object.is(body[key], original[key])) changes[key] = body[key];
    }
    return changes;
  }

  async function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    let body: Record<string, unknown>;
    if (isEdit) {
      body = changedBody();
      if (Object.keys(body).length === 0) {
        setSaved(true);
        return;
      }
      const parsed = updateExamSchema.safeParse(body);
      if (!parsed.success) return setErrors(zodFieldMap(parsed.error));
      // Re-check the merged schedule like the server does.
      const merged = createExamSchema.safeParse({ ...toBody(form) });
      if (!merged.success) {
        const fields = zodFieldMap(merged.error);
        // The saved start may already be in the past; only complain if the user changed it.
        if (fields.startAt === START_IN_PAST_MESSAGE && body.startAt === undefined) delete fields.startAt;
        const relevant = Object.fromEntries(Object.entries(fields).filter(([key]) => !locked || key in body));
        if (Object.keys(relevant).length > 0) return setErrors(relevant);
      }
    } else {
      body = toBody(form);
      const parsed = createExamSchema.safeParse(body);
      if (!parsed.success) return setErrors(zodFieldMap(parsed.error));
    }

    setSaving(true);
    try {
      const result = await apiFetch<{ exam: ExamDetail }>(isEdit ? `/api/exams/${exam.id}` : "/api/exams", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      if (isEdit) {
        setForm(initialState(result.exam));
        setSaved(true);
      }
      onSaved(result.exam);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors(error.fields);
        setFormError(error.message);
      } else {
        setFormError("Something went wrong");
      }
    } finally {
      setSaving(false);
    }
  }

  const scheduleDisabled = locked || saving;
  const describedBy = (field: string) => (errors[field] ? `exam-${field}-error` : undefined);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {locked && exam?.lockReason && (
        <Notice tone="warning" role="status">
          <strong className="font-semibold">Schedule locked.</strong> {exam.lockReason} Only the title and instructions can be
          changed now.
        </Notice>
      )}
      {formError && (
        <Notice tone="error" role="alert">
          {formError}
        </Notice>
      )}
      {saved && (
        <Notice tone="success" role="status">
          Changes saved.
        </Notice>
      )}

      <Field label="Title" htmlFor="exam-title" error={errors.title}>
        <input
          id="exam-title"
          className={inputClass}
          value={form.title}
          maxLength={200}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={describedBy("title")}
          onChange={(e) => set("title", e.target.value)}
          autoFocus={!isEdit}
        />
      </Field>

      <Field label="Instructions for candidates" htmlFor="exam-instructions" error={errors.instructions} hint="Shown before the exam starts.">
        <textarea
          id="exam-instructions"
          className={`${inputClass} min-h-28`}
          value={form.instructions}
          maxLength={10_000}
          aria-invalid={Boolean(errors.instructions)}
          aria-describedby={describedBy("instructions")}
          onChange={(e) => set("instructions", e.target.value)}
        />
      </Field>

      <fieldset className="flex flex-col gap-4" disabled={scheduleDisabled}>
        <legend className="mb-1 text-sm font-semibold">
          Schedule{" "}
          <span className="font-normal opacity-60">
            {timeZone ? `· times are in your time zone (${timeZone})` : "· times are in your time zone"}
          </span>
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Opens at" htmlFor="exam-startAt" error={errors.startAt}>
            <input
              id="exam-startAt"
              type="datetime-local"
              className={inputClass}
              value={form.startAt}
              aria-invalid={Boolean(errors.startAt)}
              aria-describedby={describedBy("startAt")}
              onChange={(e) => set("startAt", e.target.value)}
            />
          </Field>
          <Field label="Closes at" htmlFor="exam-endAt" error={errors.endAt}>
            <input
              id="exam-endAt"
              type="datetime-local"
              className={inputClass}
              value={form.endAt}
              min={form.startAt || undefined}
              aria-invalid={Boolean(errors.endAt)}
              aria-describedby={describedBy("endAt")}
              onChange={(e) => set("endAt", e.target.value)}
            />
          </Field>
          <Field
            label="Duration (minutes)"
            htmlFor="exam-durationMin"
            error={errors.durationMin}
            hint={windowMin !== null ? `Window: ${formatDuration(windowMin)}` : "Time each candidate gets."}
          >
            <input
              id="exam-durationMin"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              className={inputClass}
              value={form.durationMin}
              aria-invalid={Boolean(errors.durationMin)}
              aria-describedby={describedBy("durationMin")}
              onChange={(e) => set("durationMin", e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4"
              checked={form.shuffleQuestions}
              onChange={(e) => set("shuffleQuestions", e.target.checked)}
            />
            Shuffle question order for each candidate
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4"
              checked={form.shuffleOptions}
              onChange={(e) => set("shuffleOptions", e.target.checked)}
            />
            Shuffle answer options (MCQ / multiple answer)
          </label>
        </div>
      </fieldset>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className={primaryButton} disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create exam"}
        </button>
      </div>
    </form>
  );
}
