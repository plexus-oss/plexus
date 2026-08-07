"use client";

/**
 * Source Associations Hook
 *
 * Fetch the connection-table slices that feed a discovered source
 * (written by the discovery loop), enriched with the connection's
 * slug + name by the API.
 */

import useSWR, { type KeyedMutator } from "swr";
import { fetcher } from "@/lib/fetcher";
import type { SourceAssociation } from "@/lib/db/types";

/** Association row + the owning connection's identity (API-enriched). */
export interface SourceAssociationWithConnection extends SourceAssociation {
  connection_slug: string | null;
  connection_name: string | null;
}

interface AssociationsResponse {
  associations: SourceAssociationWithConnection[];
}

export interface UseSourceAssociationsResult {
  associations: SourceAssociationWithConnection[];
  isLoading: boolean;
  error: Error | null;
  mutate: KeyedMutator<AssociationsResponse>;
}

/** `sourceRef` accepts UUID or slug (same resolution as the sources API). */
export function useSourceAssociations(
  sourceRef: string | null,
): UseSourceAssociationsResult {
  const { data, error, isLoading, mutate } = useSWR<AssociationsResponse>(
    sourceRef ? `/api/sources/${sourceRef}/associations` : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    associations: data?.associations ?? [],
    isLoading,
    error: error instanceof Error ? error : null,
    mutate,
  };
}
