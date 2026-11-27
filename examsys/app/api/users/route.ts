import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { readJson, withErrors } from "@/lib/api/errors";
import { createUser, listUsers } from "@/lib/server/users";
import { createUserSchema, listUsersQuerySchema } from "@/lib/validation/users";

/** GET /api/users?search=&role=&active=&page=&pageSize=  (ADMIN) */
export const GET = withErrors(async (request: Request) => {
  await requireRole(request, Role.ADMIN);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = listUsersQuerySchema.parse(params);
  return NextResponse.json(await listUsers(query));
});

/** POST /api/users  (ADMIN) -> 201 { user } */
export const POST = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.ADMIN);
  const input = createUserSchema.parse(await readJson(request));
  const user = await createUser(input, session.userId);
  return NextResponse.json({ user }, { status: 201 });
});
