import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { zodFieldMap } from "@/lib/validation/fields";

/**
 * Member 2's route wrapper. It builds on Member 1's `AppError` (lib/errors.ts), so
 * errors thrown by M1's guards and services render the same way, and adds what
 * M1's `apiHandler` does not cover yet:
 * - a context argument, for dynamic routes like /api/users/[id];
 * - zod errors -> 400 VALIDATION_ERROR with per-field messages;
 * - Prisma unique / not-found / serialization errors -> 409 / 404 / 409.
 */

/** Error codes from the shared contract (section 4). */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "EXAM_NOT_AVAILABLE"
  | "EXAM_ENDED"
  | "ATTEMPT_CLOSED"
  | "NOT_ENROLLED"
  | "RATE_LIMITED";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EXAM_NOT_AVAILABLE: 403,
  EXAM_ENDED: 403,
  ATTEMPT_CLOSED: 409,
  NOT_ENROLLED: 403,
  RATE_LIMITED: 429,
};

/** `AppError` with the status looked up from the code. */
export class ApiError extends AppError {
  constructor(code: ErrorCode, message: string, fields?: Record<string, string>, details?: Record<string, unknown>) {
    super(code, STATUS[code], message, fields, details);
  }
}

export const notFound = (what = "Resource") => new ApiError("NOT_FOUND", `${what} not found`);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new ApiError("CONFLICT", message, undefined, details);
export const validation = (message: string, fields?: Record<string, string>) =>
  new ApiError("VALIDATION_ERROR", message, fields);

export type ErrorBody = {
  error: { code: string; message: string; fields?: Record<string, string>; details?: unknown };
};

function isNextControlFlow(error: unknown) {
  // Next.js signals prerender interruption / redirects with errors that must propagate.
  return typeof error === "object" && error !== null && "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    /^(NEXT_PRERENDER_INTERRUPTED|NEXT_REDIRECT|NEXT_NOT_FOUND|DYNAMIC_SERVER_USAGE)/.test((error as { digest: string }).digest);
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return validation("Some fields are invalid", zodFieldMap(error));
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return conflict("A record with these details already exists");
    if (error.code === "P2025") return notFound();
    if (error.code === "P2034") return conflict("Another change happened at the same time. Please try again.");
  }
  console.error("Unhandled API error", error);
  return new AppError("INTERNAL", 500, "An unexpected error occurred");
}

export function errorResponse(error: unknown): NextResponse<ErrorBody> {
  const appError = toAppError(error);
  const body: ErrorBody = { error: { code: appError.code, message: appError.message } };
  if (appError.fields) body.error.fields = appError.fields;
  if (appError.details) body.error.details = appError.details;
  return NextResponse.json(body, { status: appError.status });
}

/** Wraps a route handler so thrown errors become contract-shaped JSON responses. */
export function withErrors<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (isNextControlFlow(error)) throw error;
      return errorResponse(error);
    }
  };
}

/** Parses a JSON body; an unreadable body is a validation error, not a 500. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw validation("Request body must be valid JSON");
  }
}
