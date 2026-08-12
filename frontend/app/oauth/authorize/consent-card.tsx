"use client";

/**
 * Consent UI for /oauth/authorize. The server component validated the
 * request; this renders the decision and calls POST /api/oauth/authorize
 * (session + role gated) on approve, then navigates to the client's
 * redirect_uri with the code. Deny bounces back with error=access_denied.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AlertTriangle, Plug } from "lucide-react";
import { OrgGuard } from "@/components/org-guard";

interface ConsentCardProps {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scope: string | null;
  resource: string | null;
  orgName: string | null;
}

type Status = "idle" | "authorizing" | "redirecting" | "error";

export function ConsentCard(props: ConsentCardProps) {
  return (
    <OrgGuard>
      <ConsentCardInner {...props} />
    </OrgGuard>
  );
}

function ConsentCardInner({
  clientId,
  clientName,
  redirectUri,
  codeChallenge,
  state,
  scope,
  resource,
  orgName,
}: ConsentCardProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const redirectHost = useMemo(() => {
    try {
      return new URL(redirectUri).host;
    } catch {
      return redirectUri;
    }
  }, [redirectUri]);

  const authorize = async () => {
    setStatus("authorizing");
    setError(null);
    try {
      const res = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          state: state ?? undefined,
          scope: scope ?? undefined,
          resource: resource ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Authorization failed (${res.status})`);
      }
      const { redirect_url } = (await res.json()) as { redirect_url: string };
      setStatus("redirecting");
      window.location.href = redirect_url;
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  const deny = () => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", "access_denied");
    if (state) url.searchParams.set("state", state);
    window.location.href = url.toString();
  };

  const busy = status === "authorizing" || status === "redirecting";

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black p-6">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-muted p-2">
            <Plug className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-medium">Authorize {clientName}</h1>
            <p className="text-xs text-muted-foreground">
              This application is requesting access to your Plexus telemetry.
            </p>
          </div>
        </div>

        <div className="rounded-md bg-muted p-3 text-xs space-y-1.5">
          <div>
            <span className="text-muted-foreground">Application: </span>
            <code className="font-mono">{clientName}</code>
          </div>
          <div>
            <span className="text-muted-foreground">Returning to: </span>
            <code className="font-mono">{redirectHost}</code>
          </div>
          {orgName && (
            <div>
              <span className="text-muted-foreground">Organization: </span>
              <code className="font-mono">{orgName}</code>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Access: </span>
            <code className="font-mono">read, write</code>
          </div>
        </div>

        {status === "error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
            <p className="text-destructive-foreground">{error}</p>
          </div>
        )}

        <div className="space-y-3">
          <Button className="w-full" onClick={authorize} disabled={busy}>
            {busy ? (
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
            onClick={deny}
            disabled={busy}
          >
            Deny
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Authorizing issues an API key scoped to your organization. You can
          revoke it any time from Settings → API keys.
        </p>
      </Card>
    </div>
  );
}
