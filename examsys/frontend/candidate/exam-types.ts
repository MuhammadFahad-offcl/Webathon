export type CandidateAccessStatus =
  | "UPCOMING"
  | "OPEN"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "RESULT_PUBLISHED"
  | "MISSED";

export type CandidateExam = {
  examId: string;
  title: string;
  instructions: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  totalMarks: number;
  phase: string;
  accessStatus: CandidateAccessStatus;
  attemptId: string | null;
  resultsPublished: boolean;
};

export type CandidateExamGroups = {
  available: CandidateExam[];
  upcoming: CandidateExam[];
  completed: CandidateExam[];
};
