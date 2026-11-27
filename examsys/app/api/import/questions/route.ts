import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { withErrors } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/guards";
import { importQuestions } from "@/lib/server/import";
import { readImportRequest } from "@/lib/server/import-file";
import { importQuerySchema } from "@/lib/validation/import";

/**
 * POST /api/import/questions[?dryRun=true]  (EXAMINER, ADMIN) - questions are owned by the caller.
 * multipart/form-data: file (.csv `topic,difficulty,type,text,marks,optionA..optionF,correct[,negativeMarks,multiScheme]`
 * or .json array of `{ topic, difficulty, type, text, marks, negativeMarks?, multiScheme?, options: [{ text, isCorrect }] }`)
 * -> { dryRun, total, valid, invalid, imported, rows: [{ row, status, errors, label }] }
 */
export const POST = withErrors(async (request: Request) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { dryRun } = importQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const source = await readImportRequest(request);
  return NextResponse.json(await importQuestions(source, { dryRun }, session));
});
