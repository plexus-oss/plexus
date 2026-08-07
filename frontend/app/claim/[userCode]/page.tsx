"use client";

/**
 * Key-claim approval page (coding-agent onboarding). Middleware guarantees
 * a session (the route is not public); the API layer additionally requires
 * org:admin/org:editor. The user lands here from the verification_url their
 * coding agent printed.
 */

import { use, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SimpleLogo } from "@/components/logo";

type ClaimInfo = {
  requestedName: string | null;
  status: "pending" | "approved" | "denied" | "expired";
};

export default function ClaimPage({
  params,
}: {
  params: Promise<{ userCode: string }>;
}) {
  const { userCode } = use(params);
  const [info, setInfo] = useState<ClaimInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<"approve" | "deny" | null>(null);
  const [decided, setDecided] = useState<"approved" | "denied" | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/auth/claim/requests/${userCode}`);
        if (res.ok) {
          setInfo((await res.json()) as ClaimInfo);
          return;
        }
        if (res.status === 403) {
          setError(
            "Only workspace admins and editors can approve API key requests.",
          );
        } else if (res.status === 404) {
          setError("This request doesn't exist. Ask your agent to start over.");
        } else {
          setError("Something went wrong. Reload to try again.");
        }
      } catch {
        setError("Something went wrong. Reload to try again.");
      }
    })();
  }, [userCode]);

  const decide = async (approve: boolean) => {
    setDeciding(approve ? "approve" : "deny");
    try {
      const res = await fetch(`/api/auth/claim/requests/${userCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve }),
      });
      if (res.ok) {
        setDecided(approve ? "approved" : "denied");
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(body?.error ?? "The decision could not be recorded.");
    } catch {
      setError("The decision could not be recorded. Try again.");
    } finally {
      setDeciding(null);
    }
  };

  const stale =
    info && info.status !== "pending"
      ? {
          approved: "This request was already approved.",
          denied: "This request was denied.",
          expired: "This request expired. Ask your agent to start over.",
        }[info.status]
      : null;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black gap-6 px-6">
      <SimpleLogo className="w-8 h-8" />
      {error || stale ? (
        <div className="text-center space-y-2 max-w-sm">
          <h1 className="text-lg font-semibold text-white">
            API key request
          </h1>
          <p className="text-sm text-zinc-400">{error ?? stale}</p>
        </div>
      ) : decided ? (
        <div className="text-center space-y-2 max-w-sm">
          <h1 className="text-lg font-semibold text-white">
            {decided === "approved" ? "Key approved" : "Request denied"}
          </h1>
          <p className="text-sm text-zinc-400">
            {decided === "approved"
              ? "Your agent will pick up the key within a few seconds. You can close this tab and return to it."
              : "No key was issued. You can close this tab."}
          </p>
        </div>
      ) : !info ? (
        <>
          <Spinner className="h-6 w-6" />
          <p className="text-sm text-zinc-400">Loading request…</p>
        </>
      ) : (
        <div className="text-center space-y-6 max-w-sm">
          <div className="space-y-2">
            <h1 className="text-lg font-semibold text-white">
              A coding agent is requesting an API key
            </h1>
            <p className="text-sm text-zinc-400">
              {info.requestedName ? (
                <>
                  It will be named{" "}
                  <span className="text-zinc-200 font-medium">
                    {info.requestedName}
                  </span>{" "}
                  and can only write telemetry to your workspace.
                </>
              ) : (
                <>The key can only write telemetry to your workspace.</>
              )}{" "}
              Code: <span className="font-mono text-zinc-200">{userCode}</span>
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => decide(false)}
              disabled={deciding !== null}
            >
              {deciding === "deny" ? "Denying…" : "Deny"}
            </Button>
            <Button
              onClick={() => decide(true)}
              disabled={deciding !== null}
            >
              {deciding === "approve" ? "Approving…" : "Approve"}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            Only approve if you just asked your coding agent to set up Plexus.
          </p>
        </div>
      )}
    </div>
  );
}
