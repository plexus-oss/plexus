/**
 * Auth.js route handlers (sign-in, callback, session, csrf, ...).
 * Mounted at /api/authjs (see basePath in lib/auth/authjs.ts) to stay
 * clear of the app's own /api/auth/* routes.
 */

import { handlers } from "@/lib/auth/authjs";

export const { GET, POST } = handlers;
