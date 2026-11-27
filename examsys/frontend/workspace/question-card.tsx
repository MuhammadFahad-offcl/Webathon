"use client";

import { WRITTEN_MAX_CHARS } from "@/lib/constants";
import { Checkbox } from "@/frontend/components/ui/checkbox";
import { Radio } from "@/frontend/components/ui/radio";
import type { AnswerResponse, AttemptAnswer, CandidateQuestion } from "@/frontend/workspace/types";

type Props = {
  question: CandidateQuestion;
  answer: AttemptAnswer | undefined;
  questionIndex: number;
  totalQuestions: number;
  locked: boolean;
  readOnly: boolean;
  onAnswer: (response: AnswerResponse) => void;
  onFlag: () => void;
  onCopyOrPaste: (type: "COPY" | "PASTE") => void;
  onPrevious: () => void;
  onNext: () => void;
};

function optionIds(answer: AttemptAnswer | undefined): string[] {
  return answer?.response && "optionIds" in answer.response ? answer.response.optionIds : [];
}

function writtenText(answer: AttemptAnswer | undefined): string {
  return answer?.response && "text" in answer.response ? answer.response.text : "";
}

export function QuestionCard({
  question,
  answer,
  questionIndex,
  totalQuestions,
  locked,
  readOnly,
  onAnswer,
  onFlag,
  onCopyOrPaste,
  onPrevious,
  onNext,
}: Readonly<Props>) {
  const disabled = locked || readOnly;
  const selectedIds = optionIds(answer);

  function toggleOption(id: string, selected: boolean) {
    if (question.type === "MCQ") {
      onAnswer({ optionIds: selected ? [id] : [] });
      return;
    }
    const next = new Set(selectedIds);
    if (selected) next.add(id);
    else next.delete(id);
    onAnswer({ optionIds: [...next] });
  }

  return (
    <article className="workspace-question page-surface" aria-labelledby={`question-title-${question.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-muted">
            Question {questionIndex + 1} of {totalQuestions}
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--brand)]">{question.marks} marks</p>
        </div>
        <button
          className="button-secondary"
          type="button"
          onClick={onFlag}
          disabled={disabled}
          aria-pressed={answer?.flagged ?? false}
        >
          <span aria-hidden="true">{answer?.flagged ? "⚑" : "⚐"}</span>
          {answer?.flagged ? "Marked for review" : "Mark for review"}
        </button>
      </header>

      <h2 className="py-6 text-xl font-bold leading-relaxed" id={`question-title-${question.id}`}>
        {question.text}
      </h2>

      {question.type === "WRITTEN" ? (
        <div className="grid gap-2">
          <label className="text-sm font-bold" htmlFor={`answer-${question.id}`}>Your answer</label>
          <textarea
            id={`answer-${question.id}`}
            className="field-control min-h-56 resize-y leading-relaxed"
            value={writtenText(answer)}
            maxLength={WRITTEN_MAX_CHARS}
            disabled={disabled}
            onChange={(event) => onAnswer({ text: event.target.value })}
            onPaste={() => onCopyOrPaste("PASTE")}
            onCopy={() => onCopyOrPaste("COPY")}
            aria-describedby={`answer-count-${question.id}`}
          />
          <p className="text-right text-xs text-muted" id={`answer-count-${question.id}`}>
            {writtenText(answer).length.toLocaleString()} / {WRITTEN_MAX_CHARS.toLocaleString()} characters
          </p>
        </div>
      ) : (
        <fieldset
          className="grid gap-3"
          disabled={disabled}
          onPaste={() => onCopyOrPaste("PASTE")}
          onCopy={() => onCopyOrPaste("COPY")}
        >
          <legend className="mb-1 text-sm font-bold">
            {question.type === "MULTI" ? "Select all that apply" : "Select one answer"}
          </legend>
          {question.options.map((option, index) => {
            const id = `question-${question.id}-option-${option.id}`;
            const selected = selectedIds.includes(option.id);
            return (
              <label className="workspace-option" htmlFor={id} key={option.id}>
                {question.type === "MCQ" ? (
                  <Radio
                    id={id}
                    name={`question-${question.id}`}
                    value={option.id}
                    checked={selected}
                    onChange={() => toggleOption(option.id, true)}
                  />
                ) : (
                  <Checkbox
                    id={id}
                    name={`question-${question.id}`}
                    value={option.id}
                    checked={selected}
                    onChange={(event) => toggleOption(option.id, event.target.checked)}
                  />
                )}
                <span className="grid flex-1 grid-cols-[2rem_minmax(0,1fr)] items-start gap-2">
                  <span className="font-mono text-xs font-bold text-muted">{String.fromCharCode(65 + index)}</span>
                  <span>{option.text}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      <footer className="mt-8 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-5">
        <button className="button-secondary" type="button" onClick={onPrevious} disabled={questionIndex === 0}>
          Previous
        </button>
        <button className="button-primary" type="button" onClick={onNext} disabled={questionIndex === totalQuestions - 1}>
          Next question
        </button>
      </footer>
    </article>
  );
}
