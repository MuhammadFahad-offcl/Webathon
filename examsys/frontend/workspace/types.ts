export type AnswerResponse =
  | { optionIds: string[] }
  | { text: string };

export type AttemptAnswer = {
  response: AnswerResponse | null;
  flagged: boolean;
  seq: number;
};

export type CandidateOption = {
  id: string;
  text: string;
};

export type CandidateQuestion = {
  id: string;
  order: number;
  type: "MCQ" | "MULTI" | "WRITTEN";
  text: string;
  marks: number;
  options: CandidateOption[];
};

export type Announcement = {
  id: string;
  message: string;
  at: string;
};

export type AttemptInfo = {
  id: string;
  status: "IN_PROGRESS" | "SUBMITTED" | "GRADED" | string;
  startedAt: string;
  expiresAt: string;
  remainingMs: number;
  inGrace: boolean;
};

export type ExamInfo = {
  title: string;
  instructions: string;
  durationMin: number;
  totalMarks: number;
};

export type AttemptPayload = {
  serverNow: string;
  attempt: AttemptInfo;
  exam: ExamInfo;
  questions: CandidateQuestion[];
  answers: Record<string, AttemptAnswer>;
  announcements: Announcement[];
};

export type WorkspaceState = {
  loading: boolean;
  error: string | null;
  attempt: AttemptInfo | null;
  exam: ExamInfo | null;
  questions: CandidateQuestion[];
  answers: Record<string, AttemptAnswer>;
  currentIndex: number;
  announcements: Announcement[];
  submittedAt: string | null;
};

export type WorkspaceAction =
  | { type: "LOAD_STARTED" }
  | { type: "LOADED"; payload: AttemptPayload }
  | { type: "LOAD_FAILED"; message: string }
  | { type: "ANSWER_CHANGED"; questionId: string; answer: AttemptAnswer }
  | { type: "FLAG_CHANGED"; questionId: string; answer: AttemptAnswer }
  | { type: "NAVIGATE"; index: number }
  | { type: "CLOCK_UPDATED"; expiresAt: string }
  | { type: "ANNOUNCEMENTS_RECEIVED"; announcements: Announcement[] }
  | { type: "ANNOUNCEMENT_DISMISSED"; id: string }
  | { type: "FINALIZED"; status: string; submittedAt: string | null };

export const initialWorkspaceState: WorkspaceState = {
  loading: true,
  error: null,
  attempt: null,
  exam: null,
  questions: [],
  answers: {},
  currentIndex: 0,
  announcements: [],
  submittedAt: null,
};
