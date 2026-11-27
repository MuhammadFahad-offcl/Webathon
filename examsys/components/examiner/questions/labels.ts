import type { Difficulty, QuestionType } from "@/lib/validation/questions";

/** "MEDIUM" -> "Medium" */
export const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

export const TYPE_LABEL: Record<QuestionType, string> = {
  MCQ: "Single choice (MCQ)",
  MULTI: "Multiple choice",
  WRITTEN: "Written",
};

export const TYPE_SHORT: Record<QuestionType, string> = { MCQ: "MCQ", MULTI: "Multi", WRITTEN: "Written" };

export const difficultyBadge: Record<Difficulty, string> = {
  EASY: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  HARD: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};
