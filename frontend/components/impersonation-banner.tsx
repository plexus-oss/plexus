"use client";

/**
 * Global amber bar shown while a Plexus staff user is impersonating a
 * customer org. Exit clears the impersonation cookie and does a full
 * navigation back to /internal so every SWR cache is rebuilt.
 */

import { usePlexusSession } from "@/hooks/use-plexus-session";

export function ImpersonationBanner() {
  const { impersonatingOrg } = usePlexusSession();

  if (!impersonatingOrg) return null;

  const handleExit = async () => {
    await fetch("/api/internal/impersonate", { method: "DELETE" });
    window.location.href = "/internal";
  };

  return (
    <div className="flex items-center justify-center gap-3 bg-yellow-500 px-4 py-1.5 text-xs font-medium text-black shrink-0">
      <span>
        Viewing <span className="font-semibold">{impersonatingOrg.name}</span>{" "}
        as Plexus staff
      </span>
      <button
        onClick={handleExit}
        className="rounded border border-black/30 px-2 py-0.5 font-semibold hover:bg-black/10"
      >
        Exit
      </button>
    </div>
  );
}
