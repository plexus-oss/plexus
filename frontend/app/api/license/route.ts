import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { licenseStatus } from "@/lib/licensing";

/**
 * GET /api/license — current license status (settings page's one line).
 * Read-only, instance-wide, fully offline; never exposes the key itself.
 */
export async function GET() {
  const { userId } = await getAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ license: licenseStatus() });
}
