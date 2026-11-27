import { Role } from "@prisma/client";
import { withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { removeEnrollment } from "@/lib/server/enrollments";

/**
 * DELETE /api/exams/:id/enrollments/:userId  (exam owner or ADMIN) -> 204
 * 404 if not enrolled; 409 if the candidate already has a real attempt.
 */
export const DELETE = withErrors(
  async (request: Request, context: { params: Promise<{ id: string; userId: string }> }) => {
    const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
    const { id, userId } = await context.params;
    await removeEnrollment(id, userId, session);
    return new Response(null, { status: 204 });
  },
);
