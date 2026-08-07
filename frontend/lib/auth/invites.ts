import "server-only";

import { createHash } from "node:crypto";

/** Invite tokens are emailed raw; only this hash is stored. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
