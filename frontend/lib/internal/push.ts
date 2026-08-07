import "server-only";

const warned = new Set<string>();

export type PushResult =
  | { ok: true; status: number }
  | {
      ok: false;
      reason: "not_configured" | "http_error" | "network_error";
      status?: number;
      message?: string;
    };

/**
 * Push to an internal service. Returns a PushResult so callers can
 * surface failure (or even retry) instead of silently eating it.
 *
 * The original fire-and-forget shape made loader pushes invisible in
 * prod when PLEXUS_LOADER_URL was missing or the loader was down,
 * causing a class of "UI says recording but no data lands" bugs that
 * looked exactly like the source filter is broken from the user's
 * perspective. Callers that don't care about the result can keep
 * ignoring it; callers that do care can branch on it.
 */
export async function pushToService(
  serviceUrl: string | undefined,
  secret: string | undefined,
  path: string,
  body: unknown,
  label: string,
): Promise<PushResult> {
  if (!serviceUrl || !secret) {
    if (!warned.has(label)) {
      warned.add(label);
      console.warn(
        `[${label}] service URL or PLEXUS_INTERNAL_SECRET not configured — skipping push`,
      );
    }
    return { ok: false, reason: "not_configured" };
  }

  try {
    const response = await fetch(`${serviceUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(`[${label}] service responded ${response.status}`);
      return { ok: false, reason: "http_error", status: response.status };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    console.error(`[${label}] push failed`, error);
    return {
      ok: false,
      reason: "network_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
