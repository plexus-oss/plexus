import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getAuth } from "@/lib/auth/session";
import { adminOrgBillingQueries } from "@/lib/db/server";
import { oauthQueries } from "@/lib/db/queries/oauth";
import { matchesMcpResource } from "@/lib/oauth/http";
import { ConsentCard } from "./consent-card";

/**
 * /oauth/authorize — OAuth 2.1 authorization endpoint (consent page).
 *
 * Session-gated by middleware (NOT in PUBLIC_ROUTE_PATTERNS): an anonymous
 * hit bounces through /sign-in?redirect_url=... and returns here with the
 * full query intact.
 *
 * Validation split per OAuth 2.1: an unknown client_id or unregistered
 * redirect_uri MUST NOT redirect (rendered error card); everything else
 * redirects back to the client with ?error=...&state=....
 */

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function errorRedirect(
  redirectUri: string,
  error: string,
  state: string | undefined,
): never {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black p-6">
      <Card className="w-full max-w-md p-8 space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
          <p>{message}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          This authorization request is invalid and cannot proceed. Close this
          tab and retry from the application that sent you here.
        </p>
      </Card>
    </div>
  );
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const clientId = one(params.client_id);
  const redirectUri = one(params.redirect_uri);
  const state = one(params.state);
  const scope = one(params.scope);
  const resource = one(params.resource);
  const responseType = one(params.response_type);
  const codeChallenge = one(params.code_challenge);
  const codeChallengeMethod = one(params.code_challenge_method);

  // Hard failures: never redirect to an unvalidated URI.
  if (!clientId) return <ErrorCard message="Missing client_id." />;
  const client = await oauthQueries.findClient(clientId);
  if (!client) return <ErrorCard message="Unknown client_id." />;
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return (
      <ErrorCard message="redirect_uri is missing or not registered for this client." />
    );
  }

  // Soft failures: bounce back to the (validated) client with an error code.
  if (responseType !== "code") {
    errorRedirect(redirectUri, "unsupported_response_type", state);
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    errorRedirect(redirectUri, "invalid_request", state);
  }
  if (resource !== undefined && !matchesMcpResource(resource)) {
    errorRedirect(redirectUri, "invalid_target", state);
  }

  const { orgId } = await getAuth();
  const orgName = orgId
    ? ((await adminOrgBillingQueries.findByOrgId(orgId))?.org_name ?? null)
    : null;

  return (
    <ConsentCard
      clientId={client.id}
      clientName={client.client_name}
      redirectUri={redirectUri}
      codeChallenge={codeChallenge}
      state={state ?? null}
      scope={scope ?? null}
      resource={resource ?? null}
      orgName={orgName}
    />
  );
}
