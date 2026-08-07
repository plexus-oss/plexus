/**
 * Structured API Error Handling
 *
 * Provides typed error codes, a factory function, and a helper
 * to convert errors into consistent JSON responses.
 *
 * Usage in route handlers:
 *   throw apiError("NOT_FOUND", "Dashboard not found");
 *   throw apiError("VALIDATION_ERROR", "Invalid body", { issues });
 */

import { NextResponse } from "next/server";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  /**
   * The caller's scope excludes this data. Distinct from NOT_FOUND so panel
   * UIs can show a quiet "not available with your access" state. Use ONLY on
   * endpoints where the caller already names the resource (dashboard panel
   * queries) — detail routes keep NOT_FOUND so scoped users can't probe
   * existence.
   */
  | "RESTRICTED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "BILLING_LIMIT"
  | "DATABASE_ERROR"
  | "CLICKHOUSE_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR";

const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RESTRICTED: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  BILLING_LIMIT: 402,
  DATABASE_ERROR: 500,
  CLICKHOUSE_ERROR: 500,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export interface ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
}

export function apiError(
  code: ErrorCode,
  message: string,
  details?: unknown,
): ApiError {
  const error = new Error(message) as ApiError;
  (error as { name: string }).name = "ApiError";
  (error as { code: ErrorCode }).code = code;
  (error as { status: number }).status = ERROR_STATUS[code];
  if (details !== undefined) {
    (error as { details: unknown }).details = details;
  }
  return error;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && error.name === "ApiError";
}

/**
 * Convert any error into a structured JSON response.
 * ApiError instances produce typed responses; unknown errors produce 500.
 */
export function errorResponse(error: unknown): NextResponse {
  if (isApiError(error)) {
    const body: Record<string, unknown> = {
      error: error.code,
      message: error.message,
    };
    if (error.details !== undefined) {
      body.details = error.details;
    }
    return NextResponse.json(body, { status: error.status });
  }

  // Unknown error — log and return generic 500
  console.error("[API] Unhandled error:", error);
  return NextResponse.json(
    { error: "INTERNAL_ERROR", message: "Internal server error" },
    { status: 500 },
  );
}
