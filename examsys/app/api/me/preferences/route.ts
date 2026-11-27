import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { readJson, withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { updatePreferencesSchema } from "@/lib/validation/preferences";

export const GET = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.ADMIN, Role.EXAMINER, Role.CANDIDATE);
  const preference = await prisma.userPreference.findUnique({
    where: { userId: session.userId },
    select: { prefs: true },
  });
  return NextResponse.json({ prefs: preference?.prefs ?? null });
});

export const PUT = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.ADMIN, Role.EXAMINER, Role.CANDIDATE);
  const input = updatePreferencesSchema.parse(await readJson(request, { maxBytes: 4 * 1024 }));
  const preference = await prisma.userPreference.upsert({
    where: { userId: session.userId },
    create: { userId: session.userId, prefs: input.prefs },
    update: { prefs: input.prefs },
    select: { prefs: true },
  });
  return NextResponse.json({ prefs: preference.prefs });
});
