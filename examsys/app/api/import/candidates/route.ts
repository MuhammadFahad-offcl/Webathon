import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { importCandidates } from "@/lib/server/import";
import { readImportRequest } from "@/lib/server/import-file";
import { examIdSchema, importQuerySchema } from "@/lib/validation/import";

// Hashing each new password (bcrypt cost 12, ~0.3 s per row) dominates a large import:
// allow up to 5 minutes on platforms that honour it (Vercel), instead of the short default.
export const maxDuration = 300;

/**
 * POST /api/import/candidates[?dryRun=true]  (EXAMINER, ADMIN)
 * multipart/form-data: file (.csv `name,email,rollNo,password` or .json array), examId? (enroll the new users)
 * -> { dryRun, total, valid, invalid, imported, rows: [{ row, status, errors, label }], credentialsCsv?, enrollment? }
 * 400 for an unreadable file, more than 2 MB or more than 2000 rows; 404 for someone else's exam.
 */
export const POST = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { dryRun } = importQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const source = await readImportRequest(request);
  source.examId = examIdSchema.parse(source.examId);
  return NextResponse.json(await importCandidates(source, { dryRun }, session));
});
