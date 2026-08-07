import { NextRequest, NextResponse } from "next/server";

// Same-origin redirects must resolve against the deployment's *public*
// origin. Behind Fly's proxy req.nextUrl.origin resolves to the internal
// bind address (https://[::]:3000 — see HOSTNAME='::' in fly.toml), so a
// post-login redirect_url would strand the user on an unreachable host and
// Auth.js would honor that poisoned callbackUrl. NEXT_PUBLIC_APP_URL is the
// public origin baked in at build (fly.toml build.args), and unlike a
// runtime secret it's reliably inlined into the edge-runtime middleware
// bundle. It points at prod even in dev, so only anchor to it in production;
// dev falls back to the request origin, keeping a localhost login on
// localhost.
function publicOrigin(req: NextRequest): string {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_APP_URL
  ) {
    try {
      return new URL(process.env.NEXT_PUBLIC_APP_URL).origin;
    } catch {
      /* malformed NEXT_PUBLIC_APP_URL — fall back to the request origin */
    }
  }
  return req.nextUrl.origin;
}

function publicUrl(req: NextRequest, path: string): string {
  return new URL(
    path.startsWith("/") ? path : `/${path}`,
    publicOrigin(req),
  ).toString();
}

/** The unauthenticated entry screens — a signed-in user has no business here. */
function isAuthScreen(pathname: string): boolean {
  return pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");
}

/**
 * Where to send an already-authenticated user who hit an auth screen. Honors
 * ?redirect_url= when it resolves to the same origin (so a deep link survives
 * the bounce); otherwise home. Never follows an off-origin target.
 */
function postAuthRedirect(req: NextRequest): URL {
  const base = publicUrl(req, "/");
  const target = req.nextUrl.searchParams.get("redirect_url");
  if (target) {
    try {
      const url = new URL(target, base);
      if (url.origin === new URL(base).origin) return url;
    } catch {
      /* malformed redirect_url — fall through to home */
    }
  }
  return new URL("/", base);
}

const PUBLIC_ROUTE_PATTERNS = [
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/setup(.*)",
  "/opengraph-image(.*)",
  "/api/ping",
  "/api/ws(.*)",
  "/api/mqtt(.*)",
  "/api/auth/verify-key(.*)",
  "/api/auth/verify-session(.*)",
  "/api/auth/verify-share(.*)",
  // Coding-agent key-claim flow: create + poll are agent-facing (no session
  // exists yet). The nested /requests/* approval routes enforce their own
  // session+role auth; /claim/[userCode] (the page) stays session-gated.
  "/api/auth/claim(.*)",
  // Auth.js — its own CSRF protects these; session middleware must not gate them.
  "/api/authjs(.*)",
  "/api/webhooks(.*)",
  "/api/cron(.*)",
  "/shared(.*)",
  "/api/shared(.*)",
  "/api/alerts(.*)",
  "/api/internal(.*)",
  "/api/sources/register(.*)",
];

const PUBLIC_ROUTE_REGEXES = PUBLIC_ROUTE_PATTERNS.map(
  (pattern) => new RegExp(`^${pattern}$`),
);

function isPublicRoute(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;
  return PUBLIC_ROUTE_REGEXES.some((re) => re.test(pathname));
}

// (Removed featureGateResponse: there are no paid features, so no URL is
// paywalled. /internal is staff-gated by its layout + the is_staff check in
// every /api/internal route, not by middleware.)

// Optimistic check only: cookie presence gates the redirect-to-sign-in UX,
// while every route handler authoritatively validates the session via
// getAuth().
const AUTHJS_SESSION_COOKIES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
];

export default async function middleware(
  req: NextRequest,
): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Already-authenticated users shouldn't see the sign-in/up screens.
  // Optimistic cookie check, mirroring the redirect-to-sign-in gate below.
  if (isAuthScreen(pathname)) {
    const hasSession = AUTHJS_SESSION_COOKIES.some((name) =>
      req.cookies.has(name),
    );
    if (hasSession) return NextResponse.redirect(postAuthRedirect(req));
    return NextResponse.next();
  }

  if (isPublicRoute(req)) return NextResponse.next();

  const isApiRoute = pathname.startsWith("/api/");
  const hasApiKey =
    isApiRoute && req.headers.get("x-api-key")?.startsWith("plx_");
  if (hasApiKey) return NextResponse.next();

  const hasSession = AUTHJS_SESSION_COOKIES.some((name) =>
    req.cookies.has(name),
  );
  if (!hasSession) {
    const returnTo = publicUrl(req, req.nextUrl.pathname + req.nextUrl.search);
    const target = new URL(
      pathname === "/auth/cli" || pathname.startsWith("/auth/cli/")
        ? "/sign-up"
        : "/sign-in",
      publicUrl(req, "/"),
    );
    target.searchParams.set("redirect_url", returnTo);
    return NextResponse.redirect(target);
  }

  // Active-org cookie is a hint (validated server-side by getAuth());
  // using it here keeps the gate UX without a session lookup per request.
  // The staff impersonation cookie wins, mirroring getAuth()'s precedence.
  return NextResponse.next();
}

// Edge runtime (the default), NOT nodejs: Next 15.5's Node-middleware path
// has a body-forwarding race (next-server.js calls clonableBody.finalize()
// without await) that drops the start of request bodies still in flight when
// the handler begins reading — in prod this broke every multipart upload
// (e.g. POST /api/org/logo) whose route does auth DB lookups before reading
// the body. The edge sandbox path forwards bodies correctly. Nothing here
// needs Node APIs (the DB-reading feature gate that once required nodejs is
// long gone), so don't set `runtime: "nodejs"` again without re-testing
// slow multipart uploads end-to-end.
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|glb|gltf|bin|hdr|exr|mp4|webm|mov)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
