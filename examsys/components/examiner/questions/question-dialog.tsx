"use client";

import { useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/client/api";
import { zodFieldMap } from "@/lib/validation/fields";
import {
  DIFFICULTIES,
  MAX_OPTIONS,
  MIN_OPTIONS,
  QUESTION_TYPES,
  questionInputSchema,
  type MultiScheme,
  type QuestionDetailDto,
  type QuestionDto,
  type QuestionType,
} from "@/lib/validation/questions";
import { inputClass, primaryButton, secondaryButton } from "@/components/examiner/users/user-dialog";
import { TYPE_LABEL, label } from "./labels";

type Props = {
  /** null = create a new question */
  question: QuestionDto | null;
  open: boolean;
  /** Changes every time the dialog opens, so the form starts fresh. */
  session: number;
  topics: string[];
  onClose: () => void;
  onSaved: (question: QuestionDto, created: boolean) => void;
};

/** Create / edit dialog for a bank question. */
export function QuestionDialog({ question, open, session, topics, onClose, onSaved }: Readonly<Props>) {
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
      aria-labelledby="question-dialog-title"
      className="m-auto max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-black/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40 dark:border-white/15"
    >
      {open && (
        <QuestionForm key={session} question={question} topics={topics} onCancel={onClose} onSaved={onSaved} />
      )}
    </dialog>
  );
}

type OptionRow = { key: number; text: string; isCorrect: boolean };

type FormState = {
  topic: string;
  difficulty: (typeof DIFFICULTIES)[number];
  type: QuestionType;
  text: string;
  defaultMarks: string;
  negativeMarks: string;
  multiScheme: MultiScheme;
  options: OptionRow[];
};

let rowKey = 0;
const row = (text = "", isCorrect = false): OptionRow => ({ key: ++rowKey, text, isCorrect });

function initialState(question: QuestionDto | null): FormState {
  if (!question) {
    return {
      topic: "",
      difficulty: "MEDIUM",
      type: "MCQ",
      text: "",
      defaultMarks: "1",
      negativeMarks: "0",
      multiScheme: "ALL_OR_NOTHING",
      options: [row(), row(), row(), row()],
    };
  }
  return {
    topic: question.topic,
    difficulty: question.difficulty,
    type: question.type,
    text: question.text,
    defaultMarks: String(question.defaultMarks),
    negativeMarks: String(question.negativeMarks),
    multiScheme: question.multiScheme,
    options: question.type === "WRITTEN" ? [row(), row()] : question.options.map((o) => row(o.text, o.isCorrect)),
  };
}

const toNumber = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));

function QuestionForm({
  question,
  topics,
  onCancel,
  onSaved,
}: Readonly<{
  question: QuestionDto | null;
  topics: string[];
  onCancel: () => void;
  onSaved: Props["onSaved"];
}>) {
  const isEdit = question !== null;
  const [form, setForm] = useState<FormState>(() => initialState(question));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lockedBy, setLockedBy] = useState<QuestionDetailDto["exams"]>([]);

  // In edit mode, look up which exams use the question so locked fields can be explained up front.
  useEffect(() => {
    if (!question || question.usedInExams === 0) return;
    let cancelled = false;
    apiFetch<{ question: QuestionDetailDto }>(`/api/questions/${question.id}`)
      .then((result) => {
        if (!cancelled) setLockedBy(result.question.exams.filter((exam) => exam.status !== "DRAFT"));
      })
      .catch(() => undefined); // the server still enforces the lock on save
    return () => {
      cancelled = true;
    };
  }, [question]);
  const locked = lockedBy.length > 0;

  const clearError = (...keys: string[]) =>
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (keys.some((k) => key === k || key.startsWith(`${k}.`))) delete next[key];
      }
      return next;
    });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    clearError(key);
  };

  function changeType(type: QuestionType) {
    setForm((current) => {
      let options = current.options;
      if (type === "MCQ") {
        // keep only the first correct option
        let seen = false;
        options = options.map((o) => {
          const keep = o.isCorrect && !seen;
          if (o.isCorrect) seen = true;
          return { ...o, isCorrect: keep };
        });
      }
      if (type !== "WRITTEN" && options.length < MIN_OPTIONS) {
        options = [...options, ...Array.from({ length: MIN_OPTIONS - options.length }, () => row())];
      }
      return { ...current, type, options };
    });
    clearError("type", "options", "negativeMarks");
  }

  function updateOption(key: number, patch: Partial<OptionRow>) {
    setForm((current) => ({
      ...current,
      options: current.options.map((o) => {
        if (o.key === key) return { ...o, ...patch };
        // MCQ: choosing a correct answer clears the others
        if (patch.isCorrect && current.type === "MCQ") return { ...o, isCorrect: false };
        return o;
      }),
    }));
    clearError("options");
  }

  const addOption = () => {
    setForm((current) => ({ ...current, options: [...current.options, row()] }));
    clearError("options");
  };
  const removeOption = (key: number) => {
    setForm((current) => ({ ...current, options: current.options.filter((o) => o.key !== key) }));
    clearError("options");
  };

  function buildBody() {
    return {
      topic: form.topic,
      difficulty: form.difficulty,
      type: form.type,
      text: form.text,
      defaultMarks: toNumber(form.defaultMarks),
      negativeMarks: form.type === "WRITTEN" ? 0 : toNumber(form.negativeMarks || "0"),
      multiScheme: form.multiScheme,
      options: form.type === "WRITTEN" ? [] : form.options.map(({ text, isCorrect }) => ({ text, isCorrect })),
    };
  }

  async function submit(event: { preventDefault(): void }) {
    event.preventDefault();
    setFormError(null);
    const body = buildBody();
    const parsed = questionInputSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(zodFieldMap(parsed.error));
      setFormError("Please fix the highlighted fields.");
      return;
    }

    setSaving(true);
    try {
      // PATCH sends the whole question; the server only applies (and locks) what actually changed.
      const result = await apiFetch<{ question: QuestionDto }>(
        isEdit ? `/api/questions/${question.id}` : "/api/questions",
        { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      onSaved(result.question, !isEdit);
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

  const showOptions = form.type !== "WRITTEN";
  const optionError = errors.options;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-6">
      <h2 id="question-dialog-title" className="text-lg font-semibold">
        {isEdit ? "Edit question" : "New question"}
      </h2>

      {locked && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Used in {lockedBy.map((exam) => `“${exam.title}”`).join(", ")}, which {lockedBy.length === 1 ? "is" : "are"}{" "}
          published. You can fix the wording, topic and difficulty; to change the type, options or marks, duplicate
          the question instead.
        </p>
      )}

      {formError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
          {formError}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Type" error={errors.type}>
          <select
            className={inputClass}
            value={form.type}
            disabled={locked}
            onChange={(e) => changeType(e.target.value as QuestionType)}
          >
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Topic" error={errors.topic}>
          <input
            className={inputClass}
            list="question-topics"
            value={form.topic}
            maxLength={100}
            onChange={(e) => set("topic", e.target.value)}
            placeholder="e.g. Networking"
          />
          <datalist id="question-topics">
            {topics.map((topic) => (
              <option key={topic} value={topic} />
            ))}
          </datalist>
        </Field>
        <Field label="Difficulty" error={errors.difficulty}>
          <select
            className={inputClass}
            value={form.difficulty}
            onChange={(e) => set("difficulty", e.target.value as FormState["difficulty"])}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {label(d)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Question" error={errors.text}>
        <textarea
          className={`${inputClass} min-h-24`}
          value={form.text}
          maxLength={5000}
          onChange={(e) => set("text", e.target.value)}
          autoFocus
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Marks" error={errors.defaultMarks}>
          <input
            className={inputClass}
            type="number"
            min={0.25}
            max={100}
            step={0.25}
            inputMode="decimal"
            value={form.defaultMarks}
            disabled={locked}
            onChange={(e) => set("defaultMarks", e.target.value)}
          />
        </Field>
        {form.type === "MCQ" && (
          <Field label="Negative marks" error={errors.negativeMarks} hint="Deducted for a wrong answer.">
            <input
              className={inputClass}
              type="number"
              min={0}
              step={0.25}
              inputMode="decimal"
              value={form.negativeMarks}
              disabled={locked}
              onChange={(e) => set("negativeMarks", e.target.value)}
            />
          </Field>
        )}
        {form.type === "MULTI" && (
          <Field label="Scoring" error={errors.multiScheme}>
            <select
              className={inputClass}
              value={form.multiScheme}
              disabled={locked}
              onChange={(e) => set("multiScheme", e.target.value as MultiScheme)}
            >
              <option value="ALL_OR_NOTHING">All or nothing</option>
              <option value="PARTIAL">Partial credit</option>
            </select>
          </Field>
        )}
        {form.type !== "MCQ" && errors.negativeMarks && (
          <p className="text-sm text-red-600 sm:col-span-2 dark:text-red-400">{errors.negativeMarks}</p>
        )}
      </div>

      {showOptions && (
        <fieldset className="flex flex-col gap-2" disabled={locked} aria-describedby="options-help">
          <legend className="mb-1 text-sm font-medium">Options</legend>
          <p id="options-help" className="text-xs opacity-60">
            {form.type === "MCQ" ? "Select the one correct answer." : "Tick every correct answer."} {MIN_OPTIONS}–
            {MAX_OPTIONS} options.
          </p>
          {form.options.map((option, index) => {
            const letter = String.fromCharCode(65 + index);
            const textError = errors[`options.${index}.text`];
            return (
              <div key={option.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    type={form.type === "MCQ" ? "radio" : "checkbox"}
                    name="correct-option"
                    className="size-4 accent-green-600"
                    checked={option.isCorrect}
                    aria-label={`Option ${letter} is correct`}
                    onChange={(e) => updateOption(option.key, { isCorrect: e.target.checked })}
                  />
                  <span className="w-5 text-sm font-medium opacity-70">{letter}</span>
                  <input
                    className={`${inputClass} flex-1`}
                    value={option.text}
                    maxLength={1000}
                    aria-label={`Option ${letter} text`}
                    aria-invalid={textError ? true : undefined}
                    onChange={(e) => updateOption(option.key, { text: e.target.value })}
                  />
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950"
                    onClick={() => removeOption(option.key)}
                    disabled={form.options.length <= MIN_OPTIONS}
                    aria-label={`Remove option ${letter}`}
                  >
                    ✕
                  </button>
                </div>
                {textError && <span className="pl-12 text-sm text-red-600 dark:text-red-400">{textError}</span>}
              </div>
            );
          })}
          {optionError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {optionError}
            </p>
          )}
          <button
            type="button"
            className="self-start text-sm text-blue-600 hover:underline disabled:opacity-40 dark:text-blue-400"
            onClick={addOption}
            disabled={form.options.length >= MAX_OPTIONS}
          >
            + Add option
          </button>
        </fieldset>
      )}
      {!showOptions && (
        <p className="rounded-md bg-black/3 px-3 py-2 text-sm opacity-80 dark:bg-white/5">
          Written answers are graded manually; no options needed.
        </p>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create question"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label: text,
  error,
  hint,
  children,
}: Readonly<{ label: string; error?: string; hint?: string; children: React.ReactNode }>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{text}</span>
      {children}
      {error ? <span className="text-red-600 dark:text-red-400">{error}</span> : hint && <span className="opacity-60">{hint}</span>}
    </label>
  );
}
