import type { WorkspaceAction, WorkspaceState } from "@/frontend/workspace/types";

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "LOAD_STARTED":
      return {
        ...state,
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
    case "LOADED":
      return {
        ...state,
        loading: false,
        error: null,
        attempt: action.payload.attempt,
        exam: action.payload.exam,
        questions: action.payload.questions,
        answers: action.payload.answers,
        announcements: action.payload.announcements,
      };
    case "LOAD_FAILED":
      return { ...state, loading: false, error: action.message };
    case "ANSWER_CHANGED":
    case "FLAG_CHANGED":
      return {
        ...state,
        answers: { ...state.answers, [action.questionId]: action.answer },
      };
    case "NAVIGATE":
      return {
        ...state,
        currentIndex: Math.min(Math.max(0, action.index), Math.max(0, state.questions.length - 1)),
      };
    case "CLOCK_UPDATED":
      return state.attempt
        ? {
            ...state,
            attempt: { ...state.attempt, expiresAt: action.expiresAt },
          }
        : state;
    case "ANNOUNCEMENTS_RECEIVED": {
      const byId = new Map(state.announcements.map((announcement) => [announcement.id, announcement]));
      for (const announcement of action.announcements) byId.set(announcement.id, announcement);
      return { ...state, announcements: [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)) };
    }
    case "ANNOUNCEMENT_DISMISSED":
      return {
        ...state,
        announcements: state.announcements.filter((announcement) => announcement.id !== action.id),
      };
    case "FINALIZED":
      return {
        ...state,
        attempt: state.attempt ? { ...state.attempt, status: action.status } : state.attempt,
        submittedAt: action.submittedAt,
      };
    default:
      return state;
  }
}
