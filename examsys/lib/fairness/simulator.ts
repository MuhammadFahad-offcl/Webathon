import { DIFFICULTIES, type Difficulty } from "@/lib/validation/questions";

/** Minimal question-bank data needed by the fairness simulator. */
export type FairnessQuestion = {
  id: string;
  difficulty: Difficulty;
  topic: string;
  /** Marks assigned to this question in the paper (not necessarily its bank default). */
  marks: number;
};

export type Distribution = Record<Difficulty, number>;

export type FairnessStatistics = {
  mean: number;
  standardDeviation: number;
  minimum: number;
  maximum: number;
};

export type FairnessSimulationOptions = {
  /** Number of papers to generate for each strategy. Defaults to 100. */
  simulations?: number;
  /** Injectable random source, primarily for reproducible tests. Defaults to Math.random. */
  random?: () => number;
};

export type FairnessSimulationRow = {
  paper: number;
  /** Marks-weighted average difficulty (1 = EASY, 2 = MEDIUM, 3 = HARD). */
  traditional: number;
  balanced: number;
  traditionalTotalMarks: number;
  balancedTotalMarks: number;
  traditionalTopicCoverage: number;
  balancedTopicCoverage: number;
};

const DIFFICULTY_SCORE: Record<Difficulty, number> = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 3,
};

function assertQuestions(questions: readonly FairnessQuestion[]): void {
  if (!Array.isArray(questions)) {
    throw new Error("Questions must be an array");
  }

  const ids = new Set<string>();
  for (const question of questions) {
    if (!question || typeof question !== "object") {
      throw new Error("Invalid question");
    }
    if (typeof question.id !== "string" || question.id.trim().length === 0) {
      throw new Error("Every question must have an id");
    }
    if (ids.has(question.id)) {
      throw new Error(`Duplicate question id: ${question.id}`);
    }
    ids.add(question.id);

    if (!DIFFICULTIES.includes(question.difficulty)) {
      throw new Error(`Invalid difficulty for question ${question.id}`);
    }
    if (typeof question.topic !== "string" || question.topic.trim().length === 0) {
      throw new Error(`Question ${question.id} must have a topic`);
    }
    if (!Number.isFinite(question.marks) || question.marks <= 0) {
      throw new Error(`Question ${question.id} must have positive finite marks`);
    }
  }
}

function validateDistribution(
  questions: readonly FairnessQuestion[],
  distribution: Distribution,
): number {
  if (!distribution || typeof distribution !== "object") {
    throw new Error("Invalid difficulty distribution");
  }

  let total = 0;
  for (const level of DIFFICULTIES) {
    const requested = distribution[level];
    if (!Number.isInteger(requested) || requested < 0) {
      throw new Error("Invalid difficulty distribution");
    }

    const available = questions.filter((question) => question.difficulty === level).length;
    if (available < requested) {
      throw new Error(`Insufficient ${level} questions: requested ${requested}, available ${available}`);
    }
    total += requested;
  }

  if (total === 0 || total > questions.length) {
    throw new Error("Invalid paper size");
  }

  return total;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error("Random source must return a number between 0 (inclusive) and 1 (exclusive)");
    }
    const swapIndex = Math.floor(value * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function paperMetrics(questions: readonly FairnessQuestion[]) {
  const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0);
  const weightedDifficulty = questions.reduce(
    (sum, question) => sum + DIFFICULTY_SCORE[question.difficulty] * question.marks,
    0,
  );

  return {
    // Normalize by marks so a high-mark question contributes proportionally more.
    difficulty: weightedDifficulty / totalMarks,
    totalMarks,
    topicCoverage: new Set(questions.map((question) => question.topic.trim().toLocaleLowerCase())).size,
  };
}

function statistics(values: readonly number[]): FairnessStatistics {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Cannot calculate statistics for empty or invalid values");
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

  return {
    mean: Number(mean.toFixed(2)),
    standardDeviation: Number(Math.sqrt(variance).toFixed(2)),
    minimum: Number(Math.min(...values).toFixed(2)),
    maximum: Number(Math.max(...values).toFixed(2)),
  };
}

/**
 * Compares unrestricted random selection with a stratified selection that honours the
 * requested EASY / MEDIUM / HARD counts. This is a simulation, not a guarantee that
 * every paper is equally difficult: marks and topic coverage can still vary.
 */
export function simulateFairness(
  questions: readonly FairnessQuestion[],
  distribution: Distribution,
  options: FairnessSimulationOptions = {},
) {
  assertQuestions(questions);
  const paperSize = validateDistribution(questions, distribution);
  const simulationCount = options.simulations ?? 100;
  const random = options.random ?? Math.random;

  if (!Number.isInteger(simulationCount) || simulationCount < 1 || simulationCount > 10_000) {
    throw new Error("Simulation count must be an integer between 1 and 10000");
  }

  const simulations: FairnessSimulationRow[] = Array.from({ length: simulationCount }, (_, index) => {
    const traditionalQuestions = shuffle(questions, random).slice(0, paperSize);
    const balancedQuestions = DIFFICULTIES.flatMap((level) =>
      shuffle(
        questions.filter((question) => question.difficulty === level),
        random,
      ).slice(0, distribution[level]),
    );

    const traditional = paperMetrics(traditionalQuestions);
    const balanced = paperMetrics(balancedQuestions);

    return {
      paper: index + 1,
      traditional: Number(traditional.difficulty.toFixed(2)),
      balanced: Number(balanced.difficulty.toFixed(2)),
      traditionalTotalMarks: Number(traditional.totalMarks.toFixed(2)),
      balancedTotalMarks: Number(balanced.totalMarks.toFixed(2)),
      traditionalTopicCoverage: traditional.topicCoverage,
      balancedTopicCoverage: balanced.topicCoverage,
    };
  });

  return {
    simulations,
    traditional: statistics(simulations.map((simulation) => simulation.traditional)),
    balanced: statistics(simulations.map((simulation) => simulation.balanced)),
    traditionalTotalMarks: statistics(simulations.map((simulation) => simulation.traditionalTotalMarks)),
    balancedTotalMarks: statistics(simulations.map((simulation) => simulation.balancedTotalMarks)),
    traditionalTopicCoverage: statistics(simulations.map((simulation) => simulation.traditionalTopicCoverage)),
    balancedTopicCoverage: statistics(simulations.map((simulation) => simulation.balancedTopicCoverage)),
  };
}
