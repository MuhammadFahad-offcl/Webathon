import { describe, expect, it } from "vitest";
import { gradeObjective } from "./attempt-service";

const options = [{ id: "a", text: "A", isCorrect: true }, { id: "b", text: "B", isCorrect: true }, { id: "c", text: "C", isCorrect: false }];
const base = { type: "MULTI" as const, text: "Question", topic: "Topic", difficulty: "EASY", negativeMarks: 0, multiScheme: "PARTIAL", options };
describe("objective marking", () => {
  it("does not penalize unanswered questions", () => expect(gradeObjective({ ...base, type: "MCQ", negativeMarks: 0.5 }, { optionIds: [] }, 2)).toBe(0));
  it("applies negative marks for a wrong MCQ", () => expect(gradeObjective({ ...base, type: "MCQ", negativeMarks: 0.5 }, { optionIds: ["c"] }, 2)).toBe(-0.5));
  it("awards partial multi marks and deducts wrong picks", () => expect(gradeObjective(base, { optionIds: ["a", "c"] }, 4)).toBe(0));
  it("requires the exact set for all-or-nothing", () => expect(gradeObjective({ ...base, multiScheme: "ALL_OR_NOTHING" }, { optionIds: ["a"] }, 4)).toBe(0));
});
