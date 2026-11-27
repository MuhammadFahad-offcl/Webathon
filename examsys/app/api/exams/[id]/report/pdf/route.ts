import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/guards";
import { withErrors } from "@/lib/api/errors";
import { renderExamReportPdf } from "@/lib/reports/pdf";
import { pdfResponse } from "@/lib/reports/response";
import { loadExamReport } from "@/lib/server/reports";

type Context = { params: Promise<{ id: string }> };

/** GET /api/exams/:id/report/pdf -> exam summary PDF (stats, distribution, ranking). Owner / admin. */
export const GET = withErrors(async (request: Request, context: Context) => {
  const session = await requireRole(request, Role.EXAMINER, Role.ADMIN);
  const { id } = await context.params;
  const bytes = await renderExamReportPdf(await loadExamReport(id, session));
  return pdfResponse(bytes, `exam-report-${id}.pdf`);
});
