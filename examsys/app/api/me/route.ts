import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/errors";
import { requireRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const GET = apiHandler(async (request) => {
  const session = await requireRole(request, Role.ADMIN, Role.EXAMINER, Role.CANDIDATE);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { id: true, name: true, email: true, role: true } });
  return NextResponse.json({ user });
});
