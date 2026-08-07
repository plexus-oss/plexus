import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { NextResponse } from "next/server"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Create a cached JSON response with proper headers
 * @param data - The data to return
 * @param maxAge - Cache duration in seconds (default: 10)
 * @param staleWhileRevalidate - SWR duration in seconds (default: 30)
 */
export function cachedJson<T>(
  data: T,
  options?: {
    maxAge?: number
    staleWhileRevalidate?: number
    status?: number
  }
): NextResponse<T> {
  const { maxAge = 10, staleWhileRevalidate = 30, status = 200 } = options || {}

  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": `private, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
      // These responses are org-scoped via the active-org cookie but share a
      // single URL across orgs (org is never in the path). Without Vary, the
      // browser would serve a cached payload from the previous org after a
      // switch. Vary: Cookie keys the cache on the cookie, so changing the
      // active org guarantees a cache miss and fresh data.
      Vary: "Cookie",
    },
  })
}

export function normalizeDate(date: Date | number): Date {
  return typeof date === "number" ? new Date(date) : date;
}
