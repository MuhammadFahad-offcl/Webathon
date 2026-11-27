import { describe, expect, it } from "vitest";
import { gradeObjective } from "./attempt-service";

const options = [{ id: "a", text: "A", isCorrect: true }, { id: "b", text: "B", isCorrect: true }, { id: "c", text: "C", isCorrect: false }];
const base = { type: "MULTI" as const, text: "Question", topic: "Topic", difficulty: "EASY", negativeMarks: 0, multiScheme: "PARTIAL", options };
describe("objective marking", () => {
  it.each([
    ["correct MCQ", { ...base, type: "MCQ" as const }, { optionIds: ["a"] }, 2, 2],
    ["wrong MCQ without penalty", { ...base, type: "MCQ" as const }, { optionIds: ["c"] }, 2, 0],
    ["wrong MCQ with penalty", { ...base, type: "MCQ" as const, negativeMarks: 0.5 }, { optionIds: ["c"] }, 2, -0.5],
    ["unanswered MCQ with penalty", { ...base, type: "MCQ" as const, negativeMarks: 0.5 }, { optionIds: [] }, 2, 0],
    ["all correct multi selections", base, { optionIds: ["a", "b"] }, 4, 4],
    ["partial multi selection", base, { optionIds: ["a"] }, 4, 2],
    ["multi selection with an incorrect pick", base, { optionIds: ["a", "c"] }, 4, 0],
    ["unanswered partial multi", base, { optionIds: [] }, 4, 0],
    ["exact all-or-nothing selection", { ...base, multiScheme: "ALL_OR_NOTHING" }, { optionIds: ["a", "b"] }, 4, 4],
    ["incomplete all-or-nothing selection", { ...base, multiScheme: "ALL_OR_NOTHING" }, { optionIds: ["a"] }, 4, 0],
    ["all-or-nothing with an incorrect pick", { ...base, multiScheme: "ALL_OR_NOTHING" }, { optionIds: ["a", "b", "c"] }, 4, 0],
    ["unanswered written response", { ...base, type: "WRITTEN" as const }, { text: "" }, 5, 0],
  ])("%s", (_name, snapshot, response, marks, expected) => {
    expect(gradeObjective(snapshot, response, marks)).toBe(expected);
  });
});
