import { describe, expect, it } from "vitest";
import { mergeOutboxAnswers } from "@/lib/offline/merge";
import type { OutboxItem } from "@/lib/offline/outbox";

describe("mergeOutboxAnswers", () => {
  it("uses a newer locally queued answer over the server answer", () => {
    const result = mergeOutboxAnswers(
      { question1: { response: { optionIds: ["old"] }, flagged: false, seq: 2 } },
      [{
        attemptId: "attempt1",
        questionId: "question1",
        response: { optionIds: ["new"] },
        flagged: true,
        seq: 3,
        elapsedMs: 1_000,
        updatedAt: 1,
      }],
    );

    expect(result.question1).toEqual({ response: { optionIds: ["new"] }, flagged: true, seq: 3 });
  });

  it("keeps the server answer when its sequence is newer", () => {
    const result = mergeOutboxAnswers(
      { question1: { response: { text: "server" }, flagged: false, seq: 4 } },
      [{
        attemptId: "attempt1",
        questionId: "question1",
        response: { text: "local" },
        flagged: true,
        seq: 3,
        elapsedMs: 1_000,
        updatedAt: 1,
      }],
    );

    expect(result.question1).toEqual({ response: { text: "server" }, flagged: false, seq: 4 });
  });

  it("does not merge malformed local responses", () => {
    const malformedItem: OutboxItem = {
      attemptId: "attempt1",
      questionId: "question1",
      response: { optionIds: [1] },
      flagged: false,
      seq: 1,
      elapsedMs: 1_000,
      updatedAt: 1,
    };

    expect(mergeOutboxAnswers({}, [malformedItem])).toEqual({});
  });
});
