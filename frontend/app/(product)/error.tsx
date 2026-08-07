"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Reset boundary for every product page. Because this lives inside
 * `(product)/layout.tsx`, a throw from a page (or one of its data hooks)
 * swaps only the content area for this state — the navbar/sidebar shell
 * stays intact instead of the whole app blanking to Next's default screen.
 *
 * `reset()` re-renders the segment, which re-runs the failed render/fetch.
 */
export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[product] route error:", error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={AlertTriangle}
        title="Something went wrong"
        description="This view failed to load. Try again, and if it keeps happening the issue is on our side."
        action={{ label: "Try again", onClick: reset }}
      />
    </div>
  );
}
