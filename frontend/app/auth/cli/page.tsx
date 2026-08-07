"use client";

/**
 * /auth/cli — landing page for the `plexus init` style CLI auth flow.
 *
 * Query params:
 *   callback : http://127.0.0.1:<port>/<path>  (required, localhost only)
 *   state    : random string the CLI generated  (required)
 *   name     : suggested key label              (optional)
 *
 * Flow:
 *   1. CLI opens this URL in a browser tab.
 *   2. If unauthenticated, the middleware redirects to sign-in and back.
 *   3. The user clicks "Authorize" — we POST /api/auth/cli/issue to mint
 *      a fresh API key, then redirect the browser to
 *        ${callback}?state=<state>&key=<plx_...>
 *   4. The CLI's local listener receives the key, persists it, shows
 *      "you can close this tab" in the browser.
 *
 * Security notes:
 *   - The callback URL is restricted to localhost / 127.0.0.1 / [::1] so
 *     a malicious link can't exfiltrate a key off-machine.
 *   - The `state` parameter prevents another tab on the user's machine
 *     from impersonating the auth flow; the CLI verifies it on receipt.
 */

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Check, Terminal, AlertTriangle } from "lucide-react";
import { OrgGuard } from "@/components/org-guard";

type Status = "idle" | "issuing" | "redirecting" | "done" | "error";

function isAllowedCallback(raw: string | null): raw is string {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1"
  );
}

export default function CliAuthPage() {
  return (
    <Suspense fallback={null}>
      <OrgGuard>
        <CliAuthPageInner />
      </OrgGuard>
    </Suspense>
  );
}

function CliAuthPageInner() {
  const params = useSearchParams();
  const callback = params.get("callback");
  const state = params.get("state");
  const suggestedName = params.get("name");

  const callbackOk = isAllowedCallback(callback);
  const stateOk = typeof state === "string" && state.length > 0;
  const ready = callbackOk && stateOk;

  // Initial status/error are derived from validating the query params, which
  // are stable for the life of the mount — so initialize them lazily instead
  // of syncing via an effect.
  const [status, setStatus] = useState<Status>(ready ? "idle" : "error");
  const [error, setError] = useState<string | null>(
    ready
      ? null
      : !callbackOk
        ? "Missing or invalid callback URL. The CLI must pass a localhost callback."
        : "Missing state token. Re-run the command and try again.",
  );

  const callbackHost = useMemo(() => {
    if (!callback) return "";
    try {
      const u = new URL(callback);
      return `${u.hostname}${u.port ? `:${u.port}` : ""}`;
    } catch {
      return "";
    }
  }, [callback]);

  const authorize = async () => {
    if (!ready) return;
    setStatus("issuing");
    setError(null);
    try {
      const res = await fetch("/api/auth/cli/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: suggestedName ?? undefined,
          scopes: ["read", "write"],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Issue failed (${res.status})`);
      }
      const { key } = (await res.json()) as { key: string };
      const url = new URL(callback);
      url.searchParams.set("state", state as string);
      url.searchParams.set("key", key);
      setStatus("redirecting");
      setTimeout(() => {
        window.location.href = url.toString();
        setStatus("done");
      }, 400);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black p-6">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted p-2">
            <Terminal className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-medium">Authorize Plexus CLI</h1>
            <p className="text-xs text-muted-foreground">
              Plexus is about to issue an API key to a process on your machine.
            </p>
          </div>
        </div>

        {ready && (
          <div className="rounded-md bg-muted p-3 text-xs space-y-1.5">
            <div>
              <span className="text-muted-foreground">Returning to: </span>
              <code className="font-mono">{callbackHost}</code>
            </div>
            {suggestedName && (
              <div>
                <span className="text-muted-foreground">Key name: </span>
                <code className="font-mono">{suggestedName}</code>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Scopes: </span>
              <code className="font-mono">read, write</code>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <p className="text-destructive-foreground">{error}</p>
          </div>
        )}

        {ready && status !== "done" && status !== "redirecting" && (
          <div className="space-y-3">
            <Button
              className="w-full"
              onClick={authorize}
              disabled={status === "issuing"}
            >
              {status === "issuing" ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Authorizing...
                </span>
              ) : (
                "Authorize"
              )}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => window.close()}
              disabled={status === "issuing"}
            >
              Cancel
            </Button>
          </div>
        )}

        {(status === "redirecting" || status === "done") && (
          <div className="rounded-md bg-muted p-3 flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-green-600" />
            <span>Authorized — return to your terminal.</span>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Plexus only sends the key to the localhost listener you opened this
          page from. We never expose it elsewhere. You can revoke it any time at{" "}
          <code className="font-mono">/api</code> on the web app.
        </p>
      </Card>
    </div>
  );
}
