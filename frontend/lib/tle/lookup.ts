/**
 * TLE Lookup — standalone fetch, no hook needed.
 */

import { toast } from "sonner";
import type { TleLookupResult } from "@/lib/types/tle";

export async function lookupTle(
  query: { norad_id?: number; name?: string }
): Promise<TleLookupResult> {
  const params = new URLSearchParams();
  if (query.norad_id) params.set("norad_id", String(query.norad_id));
  if (query.name) params.set("name", query.name);

  const res = await fetch(`/api/tle/lookup?${params}`);
  const result = await res.json();

  if (!res.ok) {
    const msg = result.message || result.error || "Lookup failed";
    toast.error(msg);
    throw new Error(msg);
  }

  return result;
}
