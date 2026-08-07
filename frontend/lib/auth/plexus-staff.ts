/**
 * Plexus Staff Auth
 *
 * Server-only utilities for checking if a user is Plexus internal staff.
 * Reads users.is_staff — flip the column directly to grant/revoke.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getAuth } from "@/lib/auth/session";

/**
 * Check if the current session user is Plexus staff.
 * Returns false if not authenticated.
 */
export async function isPlexusStaff(): Promise<boolean> {
  const { userId } = await getAuth();
  if (!userId) return false;
  return isPlexusStaffById(userId);
}

/**
 * Check if a specific user is Plexus staff.
 */
export async function isPlexusStaffById(userId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ is_staff: users.is_staff })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.is_staff === true;
  } catch {
    return false;
  }
}
