"use client";

import { usePlexusSession } from "@/hooks/use-plexus-session";

/**
 * Client-side hook to check if the current user is Plexus internal staff.
 */
export function usePlexusStaff(): { isStaff: boolean; isLoaded: boolean } {
  const { isStaff, isLoaded } = usePlexusSession();

  return {
    isStaff: isLoaded && isStaff,
    isLoaded,
  };
}
