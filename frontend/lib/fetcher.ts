/**
 * Shared SWR fetcher with structured error handling.
 *
 * Parses API responses that follow the { error, message, details } format
 * and attaches the error code to thrown errors for client-side handling.
 *
 * Usage: `useSWR(url, fetcher)`
 */

export interface FetchError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;
}

export function createFetchError(
  message: string,
  status: number,
  code?: string,
  details?: unknown,
): FetchError {
  const error = new Error(message) as FetchError;
  (error as { name: string }).name = "FetchError";
  (error as { status: number }).status = status;
  (error as { code: string | undefined }).code = code;
  (error as { details: unknown }).details = details;
  return error;
}

export function isFetchError(error: unknown): error is FetchError {
  return error instanceof Error && error.name === "FetchError";
}

export const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw createFetchError(
      body.message || body.error || "Failed to fetch",
      res.status,
      body.error,
      body.details,
    );
  }
  // A 200 HTML response means middleware redirected to a login page (session
  // expiry). Treat it as a 401 so SWR surfaces a clean auth error instead of
  // a confusing JSON parse failure.
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw createFetchError("Session expired", 401, "auth_redirect");
  }
  return res.json();
};
