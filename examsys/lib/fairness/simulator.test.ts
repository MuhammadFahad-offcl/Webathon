import { describe, expect, it } from "vitest";
import { simulateFairness, type FairnessQuestion } from "./simulator";

const questions: FairnessQuestion[] = [
  { id: "e1", difficulty: "EASY", topic: "Algebra", marks: 2 },
  { id: "e2", difficulty: "EASY", topic: "Geometry", marks: 1 },
  { id: "e3", difficulty: "EASY", topic: "Algebra", marks: 3 },
  { id: "m1", difficulty: "MEDIUM", topic: "Algebra", marks: 2 },
  { id: "m2", difficulty: "MEDIUM", topic: "Calculus", marks: 4 },
  { id: "m3", difficulty: "MEDIUM", topic: "Geometry", marks: 1 },
  { id: "h1", difficulty: "HARD", topic: "Calculus", marks: 5 },
  { id: "h2", difficulty: "HARD", topic: "Geometry", marks: 2 },
  { id: "h3", difficulty: "HARD", topic: "Algebra", marks: 3 },
];

const distribution = { EASY: 1, MEDIUM: 1, HARD: 1 };
const stableRandom = () => 0.5;

describe("simulateFairness", () => {
  it("generates the requested number of papers with the requested paper size", () => {
    const result = simulateFairness(questions, distribution, {
      simulations: 12,
      random: stableRandom,
    });

    expect(result.simulations).toHaveLength(12);
    expect(result.simulations.map((paper) => paper.paper)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(result.traditional.mean).toBeGreaterThanOrEqual(1);
    expect(result.traditional.mean).toBeLessThanOrEqual(3);
    expect(result.balanced.mean).toBeGreaterThanOrEqual(1);
    expect(result.balanced.mean).toBeLessThanOrEqual(3);
  });

  it("keeps the balanced paper's difficulty counts exact", () => {
    const result = simulateFairness(questions, distribution, {
      simulations: 20,
      random: stableRandom,
    });

    // One question at each difficulty means the balanced weighted difficulty is always 2,
    // regardless of the selected marks.
    expect(result.balanced).toEqual({
      mean: 2,
      standardDeviation: 0,
      minimum: 2,
      maximum: 2,
    });
  });

  it("reports marks and distinct topic coverage", () => {
    const result = simulateFairness(questions, distribution, {
      simulations: 5,
      random: stableRandom,
    });

    expect(result.simulations.every((paper) => paper.traditionalTotalMarks > 0)).toBe(true);
    expect(result.simulations.every((paper) => paper.balancedTotalMarks > 0)).toBe(true);
    expect(result.simulations.every((paper) => paper.traditionalTopicCoverage >= 1)).toBe(true);
    expect(result.simulations.every((paper) => paper.balancedTopicCoverage >= 1)).toBe(true);
    expect(result.balancedTotalMarks.mean).toBeGreaterThan(0);
  });

  it("supports a one-paper simulation", () => {
    const result = simulateFairness(questions, distribution, {
      simulations: 1,
      random: stableRandom,
    });

    expect(result.simulations).toHaveLength(1);
    expect(result.traditional.standardDeviation).toBe(0);
    expect(result.balanced.standardDeviation).toBe(0);
  });

  it("rejects invalid distributions and insufficient question pools", () => {
    expect(() =>
      simulateFairness(questions, { EASY: -1, MEDIUM: 1, HARD: 1 }),
    ).toThrow("Invalid difficulty distribution");

    expect(() =>
      simulateFairness(questions, { EASY: 4, MEDIUM: 0, HARD: 0 }),
    ).toThrow("Insufficient EASY questions");

    expect(() =>
      simulateFairness(questions, { EASY: 0, MEDIUM: 0, HARD: 0 }),
    ).toThrow("Invalid paper size");

    expect(() =>
      simulateFairness(questions, { EASY: 2, MEDIUM: 2, HARD: 2 }),
    ).toThrow("Invalid paper size");
  });

  it("rejects invalid question data and duplicate ids", () => {
    expect(() =>
      simulateFairness([{ ...questions[0], marks: 0 }], { EASY: 1, MEDIUM: 0, HARD: 0 }),
    ).toThrow("must have positive finite marks");

    expect(() =>
      simulateFairness([{ ...questions[0], topic: " " }], { EASY: 1, MEDIUM: 0, HARD: 0 }),
    ).toThrow("must have a topic");

    expect(() =>
      simulateFairness([questions[0], { ...questions[1], id: questions[0].id }], {
        EASY: 2,
        MEDIUM: 0,
        HARD: 0,
      }),
    ).toThrow("Duplicate question id");
  });

  it("rejects invalid simulation counts and random sources", () => {
    expect(() =>
      simulateFairness(questions, distribution, { simulations: 0 }),
    ).toThrow("Simulation count");

    expect(() =>
      simulateFairness(questions, distribution, { simulations: 1, random: () => 1 }),
    ).toThrow("Random source");
  });
});
