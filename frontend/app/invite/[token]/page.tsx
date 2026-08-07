"use client";

/**
 * Invite acceptance landing page. Middleware guarantees a session (the
 * route is not public), so this just redeems the token and routes home —
 * or explains why it couldn't.
 */

import { use, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { SimpleLogo } from "@/components/logo";

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    (async () => {
      try {
        const res = await fetch("/api/invites/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (res.ok) {
          window.location.assign("/");
          return;
        }
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "This invitation could not be accepted.");
      } catch {
        setError("Something went wrong. Try the link again.");
      }
    })();
  }, [token]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black gap-6 px-6">
      <SimpleLogo className="w-8 h-8" />
      {error ? (
        <div className="text-center space-y-2 max-w-sm">
          <h1 className="text-lg font-semibold text-white">
            Invitation problem
          </h1>
          <p className="text-sm text-zinc-400">{error}</p>
        </div>
      ) : (
        <>
          <Spinner className="h-6 w-6" />
          <p className="text-sm text-zinc-400">Joining workspace…</p>
        </>
      )}
    </div>
  );
}
