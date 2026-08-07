"use client";

/**
 * Per-panel error boundary.
 *
 * Wraps each grid cell's PanelRenderer so a runtime throw in one panel
 * (three.js, deck.gl, a bad config) degrades to an inline fallback instead
 * of unmounting the whole dashboard route. Resets when the panel's id or
 * type changes (e.g. the user reconfigures the panel), and on demand via
 * the Retry button.
 */

import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

function PanelCrashFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";

  return (
    <div className="h-full flex flex-col items-center justify-center p-4 text-center">
      <AlertCircle className="h-8 w-8 mb-2 text-destructive" />
      <p className="text-sm font-medium text-destructive">Panel crashed</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-[280px] break-words">
        {message}
      </p>
      <div className="flex gap-2 mt-3">
        <Button size="sm" variant="outline" onClick={resetErrorBoundary}>
          Retry
        </Button>
      </div>
    </div>
  );
}

export function PanelErrorBoundary({
  panelId,
  panelType,
  children,
}: {
  panelId: string;
  panelType: string;
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary
      FallbackComponent={PanelCrashFallback}
      resetKeys={[panelId, panelType]}
      onError={(error) => {
        console.error(`Panel ${panelId} (${panelType}) crashed:`, error);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
