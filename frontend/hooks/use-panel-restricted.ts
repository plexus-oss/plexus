"use client";

/**
 * Client-side gate: is this panel's data entirely outside the viewer's
 * visibility scope?
 *
 * Server enforcement already guarantees a scoped member gets no out-of-scope
 * DATA (queries are filtered or rejected). This hook exists for UX: rather
 * than an empty chart or a failed query, the panel renders a labeled
 * "not available with your access" state.
 *
 * Only active for scope-restricted members (usePermissions().scoped) — for
 * everyone else (including share-link viewers with no session) it returns
 * false without doing any work. Panels referencing a mix of sources render
 * normally and show the accessible subset.
 */

import { useMemo } from "react";
import { usePermissions } from "@/hooks/use-permissions";
import { useSourcesSwr } from "@/hooks/use-sources-swr";
import { getPanelDataSource } from "@/lib/panels/data-source";
import type { Panel } from "@/lib/types/dashboard";

const PLEXUS_SOURCE_ID = "__plexus__";

/** Source refs (slugs and/or ids) a panel's data depends on. */
function referencedSources(panel: Panel): string[] {
  const ds = getPanelDataSource(panel);
  if (ds.kind === "sql") {
    // The internal telemetry pseudo-source is row-filtered server-side.
    if (!ds.sourceId || ds.sourceId === PLEXUS_SOURCE_ID) return [];
    return [ds.sourceId];
  }
  const refs = new Set<string>();
  for (const key of ds.metrics) {
    const i = key.indexOf(":");
    if (i > 0) refs.add(key.substring(0, i)); // "slug:metric"
  }
  if (ds.sourceId) refs.add(ds.sourceId);
  return [...refs];
}

export function usePanelRestricted(panel: Panel): boolean {
  const { scoped } = usePermissions();
  // The sources list is already scope-filtered server-side — it IS the
  // viewer's visible set. Only fetched into cache here; every dashboard
  // page loads it anyway (SWR dedup).
  const { sources, isLoading } = useSourcesSwr();

  return useMemo(() => {
    if (!scoped || isLoading) return false;
    const refs = referencedSources(panel);
    if (refs.length === 0) return false;
    const visible = new Set<string>();
    for (const s of sources ?? []) {
      visible.add(s.id);
      visible.add(s.slug);
    }
    // Restricted only when NOTHING the panel references is visible —
    // mixed-access panels render their accessible subset.
    return refs.every((ref) => !visible.has(ref));
  }, [scoped, isLoading, sources, panel]);
}
