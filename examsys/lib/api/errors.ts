import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { zodFieldMap } from "@/lib/validation/fields";

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
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

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
  INTERNAL_ERROR: 500,
};

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
};

/** Throw from any route or service; `withErrors` turns it into the contract's JSON shape. */
export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Resource") => new ApiError("NOT_FOUND", `${what} not found`);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new ApiError("CONFLICT", message, undefined, details);
export const validation = (message: string, fields?: Record<string, string>) =>
  new ApiError("VALIDATION_ERROR", message, fields);

export function errorResponse(error: unknown): NextResponse<ErrorBody> {
  let apiError: ApiError;
  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = validation("Some fields are invalid", zodFieldMap(error));
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    apiError = conflict("A record with these details already exists");
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    apiError = conflict("Another change happened at the same time. Please try again.");
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    apiError = notFound();
  } else {
    console.error(error);
    apiError = new ApiError("INTERNAL_ERROR", "Something went wrong");
  }
  const body: ErrorBody = { error: { code: apiError.code, message: apiError.message } };
  if (apiError.fields) body.error.fields = apiError.fields;
  if (apiError.details) body.error.details = apiError.details;
  return NextResponse.json(body, { status: apiError.status });
}

/** Wraps a route handler so thrown errors become contract-shaped JSON responses. */
export function withErrors<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (error) {
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
