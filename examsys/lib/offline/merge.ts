import type { AnswerResponse, AttemptAnswer } from "@/frontend/workspace/types";
import type { OutboxItem } from "@/lib/offline/outbox";

function isAnswerResponse(value: unknown): value is AnswerResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (typeof response.text === "string" && Object.keys(response).length === 1) return true;
  return (
    Array.isArray(response.optionIds) &&
    response.optionIds.every((id) => typeof id === "string") &&
    Object.keys(response).length === 1
  );
}

export function mergeOutboxAnswers(
  serverAnswers: Record<string, AttemptAnswer>,
  outbox: OutboxItem[],
): Record<string, AttemptAnswer> {
  const merged = { ...serverAnswers };
  for (const item of outbox) {
    const saved = merged[item.questionId];
    if ((!saved || item.seq > saved.seq) && isAnswerResponse(item.response)) {
      merged[item.questionId] = {
        response: item.response,
        flagged: item.flagged,
        seq: item.seq,
      };
    }
  }
  return merged;
}
