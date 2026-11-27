import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/guards";
import { withErrors } from "@/lib/api/errors";
import { renderAttemptReportPdf } from "@/lib/reports/pdf";
import { qrPng, verifyUrl } from "@/lib/reports/qr";
import { pdfResponse } from "@/lib/reports/response";
import { loadAttemptReport } from "@/lib/server/reports";

type Context = { params: Promise<{ attemptId: string }> };

/**
 * GET /api/reports/:attemptId/pdf -> application/pdf result statement with QR verification.
 * Candidate (own attempt, results published) or the exam's examiner / admin (api.md 16.1).
 */
export const GET = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN, Role.CANDIDATE);
  const { attemptId } = await context.params;
  const report = await loadAttemptReport(attemptId, session);
  const url = verifyUrl(report.verifyCode, request);
  const bytes = await renderAttemptReportPdf({ ...report, verifyUrl: url }, await qrPng(url));
  return pdfResponse(bytes, `result-${attemptId}.pdf`);
});
