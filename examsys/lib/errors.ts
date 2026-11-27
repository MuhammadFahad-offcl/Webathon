import { NextResponse } from "next/server";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function apiHandler(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (typeof error === "object" && error !== null && "digest" in error && (error as { digest?: unknown }).digest === "NEXT_PRERENDER_INTERRUPTED") {
        throw error;
      }
      if (error instanceof AppError) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}), ...(error.details ? { details: error.details } : {}) } },
          { status: error.status },
        );
      }
      console.error("Unhandled API error", error);
      return NextResponse.json({ error: { code: "INTERNAL", message: "An unexpected error occurred" } }, { status: 500 });
    }
  };
}
