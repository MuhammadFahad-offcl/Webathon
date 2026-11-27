import { describe, expect, it } from "vitest";
import { ExamStatus } from "@prisma/client";
import { candidateAccessStatus, deriveExamPhase } from "./exam-lifecycle";

const start = new Date("2026-11-27T10:00:00.000Z");
const end = new Date("2026-11-27T11:00:00.000Z");
describe("deriveExamPhase", () => {
  it("derives schedule phases and preserves stored states", () => {
    expect(deriveExamPhase({ status: ExamStatus.DRAFT, startAt: start, endAt: end }, start)).toBe("DRAFT");
    expect(deriveExamPhase({ status: ExamStatus.PUBLISHED, startAt: start, endAt: end }, new Date("2026-11-27T09:59:59.000Z"))).toBe("UPCOMING");
    expect(deriveExamPhase({ status: ExamStatus.PUBLISHED, startAt: start, endAt: end }, start)).toBe("ONGOING");
    expect(deriveExamPhase({ status: ExamStatus.PUBLISHED, startAt: start, endAt: end }, new Date("2026-11-27T11:00:01.000Z"))).toBe("COMPLETED");
  });
});

describe("candidateAccessStatus", () => {
  it("prioritizes existing attempts and published results", () => {
    expect(candidateAccessStatus({ phase: "ONGOING", hasInProgressAttempt: true, hasFinishedAttempt: false, resultsPublished: false })).toBe("IN_PROGRESS");
    expect(candidateAccessStatus({ phase: "COMPLETED", hasInProgressAttempt: false, hasFinishedAttempt: true, resultsPublished: true })).toBe("RESULT_PUBLISHED");
    expect(candidateAccessStatus({ phase: "COMPLETED", hasInProgressAttempt: false, hasFinishedAttempt: false, resultsPublished: false })).toBe("MISSED");
  });
});
