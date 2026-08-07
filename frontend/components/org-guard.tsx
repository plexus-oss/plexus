"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { SimpleLogo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { useMyOrgs, setActiveOrg, createOrg } from "@/hooks/use-my-orgs";

interface OrgGuardProps {
  children: React.ReactNode;
}

function deriveWorkspaceName(args: {
  firstName?: string | null;
  email?: string | null;
}): string {
  const first = args.firstName?.trim();
  if (first) return `${first}'s Workspace`;
  const handle = args.email?.split("@")[0];
  if (handle) return `${handle}'s Workspace`;
  return "My Workspace";
}

function GuardSpinner({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black gap-4">
      <Spinner className="h-6 w-6" />
      {message ? <p className="text-sm text-zinc-400">{message}</p> : null}
    </div>
  );
}

function GuardError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black gap-8 px-6">
      <SimpleLogo className="w-8 h-8" />
      <div className="text-center space-y-3 max-w-sm">
        <h1 className="text-lg font-semibold text-white">
          We couldn&rsquo;t set up your workspace.
        </h1>
        <p className="text-sm text-zinc-400">{message}</p>
        <div className="flex justify-center gap-2 pt-2">
          <Button onClick={onRetry}>Try again</Button>
          <a
            href="mailto:sales@plexus.company"
            className="text-sm text-zinc-400 hover:text-white underline underline-offset-2 self-center"
          >
            Contact support
          </a>
        </div>
      </div>
    </div>
  );
}

export function OrgGuard({ children }: OrgGuardProps) {
  const { isLoaded: sessionLoaded, isSignedIn, orgId, firstName, email } =
    usePlexusSession();
  const { isLoaded: orgsLoaded, orgs } = useMyOrgs();
  const [isWorking, setIsWorking] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionLoaded || !orgsLoaded || !isSignedIn) return;
    if (orgId || isWorking || createError) return;

    (async () => {
      setIsWorking(true);
      // getAuth() already falls back to the first membership, so reaching
      // here with no orgId means zero memberships — provision a workspace.
      // Setting the cookie explicitly keeps the choice sticky either way.
      if (orgs.length > 0) {
        await setActiveOrg(orgs[0].orgId);
        window.location.reload();
        return;
      }
      const created = await createOrg(deriveWorkspaceName({ firstName, email }));
      if (created) {
        window.location.reload();
      } else {
        setCreateError("Could not create workspace.");
        setIsWorking(false);
      }
    })().catch((err) => {
      console.error("[OrgGuard] workspace setup failed", err);
      setCreateError(
        err instanceof Error ? err.message : "Could not create workspace.",
      );
      setIsWorking(false);
    });
  }, [
    sessionLoaded,
    orgsLoaded,
    isSignedIn,
    orgId,
    orgs,
    isWorking,
    createError,
    firstName,
    email,
  ]);

  if (!sessionLoaded) {
    return <GuardSpinner />;
  }

  if (!isSignedIn) {
    return <>{children}</>;
  }

  if (orgId) {
    return <>{children}</>;
  }

  if (createError) {
    return (
      <GuardError message={createError} onRetry={() => setCreateError(null)} />
    );
  }

  return (
    <GuardSpinner message={isWorking ? "Setting up your workspace…" : undefined} />
  );
}
