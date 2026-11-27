/**
 * The exam workspace the sandbox page renders: the ONE swap point for Member 3.
 *
 * Temporary until Member 3's exam workspace lands. To swap it in, change this export to
 * Member 3's component (it must accept `ExamWorkspaceProps`: `attemptId` and `onSubmitted(status)`,
 * and talk to the same /api/attempts/:id endpoints), then delete `sandbox-workspace.tsx`.
 */
export { SandboxWorkspace as ExamWorkspace, type ExamWorkspaceProps } from "./sandbox-workspace";
