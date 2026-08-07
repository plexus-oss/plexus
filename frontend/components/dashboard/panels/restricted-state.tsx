"use client";

/**
 * Quiet panel state for data outside the viewer's access scope. Deliberately
 * calm — muted, no destructive styling — a scoped member seeing this on a
 * shared dashboard is expected, not an error.
 */

import { Lock } from "lucide-react";

export function PanelRestrictedState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
      <Lock className="h-4 w-4 text-muted-foreground/60" />
      <p className="text-sm text-muted-foreground">
        Not available with your access
      </p>
      <p className="text-[11px] text-muted-foreground/70">
        This panel uses data outside your scope.
      </p>
    </div>
  );
}
