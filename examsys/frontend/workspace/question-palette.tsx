import type { AttemptAnswer, CandidateQuestion } from "@/frontend/workspace/types";

type Props = {
  questions: CandidateQuestion[];
  answers: Record<string, AttemptAnswer>;
  currentIndex: number;
  onSelect: (index: number) => void;
};

function isAnswered(answer: AttemptAnswer | undefined): boolean {
  if (!answer?.response) return false;
  if ("text" in answer.response) return answer.response.text.trim().length > 0;
  return answer.response.optionIds.length > 0;
}

export function QuestionPalette({ questions, answers, currentIndex, onSelect }: Readonly<Props>) {
  return (
    <section className="workspace-palette page-surface" aria-labelledby="palette-heading">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-bold" id="palette-heading">Questions</h2>
        <span className="text-xs text-muted">{questions.length} total</span>
      </div>
      <div className="workspace-palette-grid">
        {questions.map((question, index) => {
          const answer = answers[question.id];
          const answered = isAnswered(answer);
          const flagged = answer?.flagged ?? false;
          const state = [
            index === currentIndex ? "current" : "",
            answered ? "answered" : "",
            flagged ? "flagged" : "",
          ].filter(Boolean).join(" ");
          const description = [
            `Question ${index + 1}`,
            answered ? "answered" : "unanswered",
            flagged ? "marked for review" : "",
            index === currentIndex ? "current" : "",
          ].filter(Boolean).join(", ");

          return (
            <button
              key={question.id}
              className={`workspace-palette-item ${state}`}
              type="button"
              onClick={() => onSelect(index)}
              aria-current={index === currentIndex ? "true" : undefined}
              aria-label={description}
              title={description}
            >
              <span>{index + 1}</span>
              {answered && <span className="palette-check" aria-hidden="true">✓</span>}
              {flagged && <span className="palette-flag" aria-hidden="true">⚑</span>}
            </button>
          );
        })}
      </div>
      <ul className="mt-4 grid gap-2 text-xs text-muted" aria-label="Question state key">
        <li><span aria-hidden="true">○</span> Unanswered</li>
        <li><span aria-hidden="true">✓</span> Answered</li>
        <li><span aria-hidden="true">⚑</span> Marked for review</li>
      </ul>
    </section>
  );
}
