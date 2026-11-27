import { NextResponse } from "next/server";
import { ApiError, errorResponse, withErrors } from "@/lib/api/errors";
import { clientIp } from "@/lib/reports/rate-limit";
import { verifyRateLimiter, verifyReport } from "@/lib/server/reports";

type Context = { params: Promise<{ code: string }> };

/**
 * GET /api/verify/:code - PUBLIC (no session, by design: api.md 16.3), rate-limited per IP.
 * 200 { valid: true, examTitle, issuedAt, candidate: "A. K.", scoreBand } or 200 { valid: false }.
 */
export const GET = withErrors(async (request: Request, context: Context) => {
  const limit = verifyRateLimiter.hit(clientIp(request));
  if (!limit.allowed) {
    const response = errorResponse(new ApiError("RATE_LIMITED", "Too many verification requests. Try again in a minute."));
    response.headers.set("retry-after", String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))));
    return response;
  }
  const { code } = await context.params;
  return NextResponse.json(await verifyReport(code), {
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
});
