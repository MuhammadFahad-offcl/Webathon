import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api/auth";
import { readJson, withErrors } from "@/lib/api/errors";
import { updateUser } from "@/lib/server/users";
import { updateUserSchema } from "@/lib/validation/users";

/**
 * PATCH /api/users/:id  (ADMIN)
 * Body: any of { name, role, active, password, rollNo }. `password` resets the password.
 */
export const PATCH = withErrors(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const session = await requireRole("ADMIN");
    const { id } = await context.params;
    const input = updateUserSchema.parse(await readJson(request));
    const user = await updateUser(id, input, session.userId);
    return NextResponse.json({ user });
  },
);
