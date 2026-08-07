"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { SharedTelemetryProvider } from "@/components/dashboard/shared-telemetry-provider";
import { SharedQueryProvider } from "@/components/dashboard/shared-query-context";
import { DashboardStateProvider } from "@/components/dashboard/dashboard-state-context";
import { DashboardInteractionProvider } from "@/components/dashboard/dashboard-interaction-context";
import { RunComparePicker } from "@/components/dashboard/run-compare-picker";
import { useSharedDashboard } from "@/hooks/use-shared-dashboard";
import { parseRelativeTime, type TimeRange } from "@/lib/types/dashboard";
import { DashboardIcon } from "@/components/dashboard/icon-picker";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LayoutDashboard, AlertCircle, Lock } from "lucide-react";

interface SharedDashboardPageProps {
  params: Promise<{ token: string }>;
}

export default function SharedDashboardPage({
  params,
}: SharedDashboardPageProps) {
  const { token } = use(params);
  const {
    data,
    error,
    isLoading,
    requiresPassword,
    shareLinkName,
    passwordError,
    fetchWithPassword,
    sessionIdRef,
    startTimeRef,
  } = useSharedDashboard(token);
  const [password, setPassword] = useState("");
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
  const searchParams = useSearchParams();
  const tParam = searchParams.get("t");
  const windowParam = searchParams.get("window");
  // Viewer-side time-range override: pan/zoom and the scrubber-style
  // interactions commit here so shared viewers can navigate history without
  // mutating the dashboard they don't own.
  const [timeRangeOverride, setTimeRangeOverride] = useState<TimeRange | null>(
    null,
  );
  const config = useMemo(() => {
    const base = data?.dashboard.config;
    if (!base) return base;
    if (timeRangeOverride) {
      return { ...base, timeRange: timeRangeOverride, refreshInterval: 0 };
    }
    if (!tParam) return base;
    const center = new Date(tParam);
    if (isNaN(center.getTime())) return base;
    const ms = parseRelativeTime(windowParam || "10m");
    const start = new Date(center.getTime() - ms / 2);
    const end = new Date(center.getTime() + ms / 2);
    return {
      ...base,
      timeRange: {
        type: "absolute" as const,
        value: `${start.toISOString()}/${end.toISOString()}`,
      },
      refreshInterval: 0,
    };
  }, [data?.dashboard.config, tParam, windowParam, timeRangeOverride]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setIsSubmittingPassword(true);
    await fetchWithPassword(password);
    setIsSubmittingPassword(false);
  };

  useEffect(() => {
    const trackDuration = () => {
      if (!sessionIdRef.current) return;

      const durationSeconds = Math.round(
        (Date.now() - startTimeRef.current) / 1000,
      );
      navigator.sendBeacon(
        `/api/shared/${token}`,
        JSON.stringify({
          sessionId: sessionIdRef.current,
          durationSeconds,
          endedAt: new Date().toISOString(),
        }),
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        trackDuration();
      }
    };

    window.addEventListener("beforeunload", trackDuration);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", trackDuration);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      trackDuration();
    };
  }, [token, sessionIdRef, startTimeRef]);

  if (isLoading && !requiresPassword) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (requiresPassword) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-full max-w-sm px-4">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
              <Lock className="h-8 w-8 text-muted-foreground" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Password Required</h1>
            <p className="text-muted-foreground">
              {shareLinkName
                ? `"${shareLinkName}" is password protected`
                : "This dashboard is password protected"}
            </p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              {passwordError && (
                <p className="text-sm text-destructive">{passwordError}</p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={!password || isSubmittingPassword}
            >
              {isSubmittingPassword ? (
                <Spinner className="h-4 w-4" />
              ) : (
                "View Dashboard"
              )}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Powered by{" "}
            <a
              href="https://plexus.company"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Plexus
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Unable to Load Dashboard</h1>
          <p className="text-muted-foreground mb-6">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { dashboard, shareLink } = data;
  const resolvedConfig = config ?? dashboard.config;

  return (
    <div className="min-h-screen bg-background">
      {resolvedConfig.panels.length === 0 ? (
        <>
          <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="px-4 py-3 flex items-center justify-start">
              <div className="flex items-center gap-3">
                <DashboardIcon
                  icon={dashboard.icon}
                  iconUrl={dashboard.icon_url}
                  size="lg"
                />
                <div>
                  <h1 className="font-semibold">{dashboard.name}</h1>
                </div>
              </div>
            </div>
          </header>
          <main className="p-4">
            <div className="flex items-center justify-center h-[60vh]">
              <div className="text-center">
                <LayoutDashboard className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h2 className="text-lg font-medium mb-2">
                  No panels in this dashboard
                </h2>
                <p className="text-sm text-muted-foreground">
                  This dashboard doesn&apos;t have any content yet.
                </p>
              </div>
            </div>
          </main>
        </>
      ) : (
        <SharedQueryProvider shareToken={token} password={password || undefined}>
          <SharedTelemetryProvider
            shareToken={token}
            orgId={shareLink.orgId}
            timeRange={resolvedConfig.timeRange}
            password={password || undefined}
          >
            <DashboardStateProvider
              filters={resolvedConfig.filters || []}
              variables={resolvedConfig.variables || []}
              refreshInterval={resolvedConfig.refreshInterval || 0}
            >
              <DashboardInteractionProvider
                currentTimeRange={resolvedConfig.timeRange}
                onTimeRangeChange={setTimeRangeOverride}
                syncTooltips={resolvedConfig.displaySettings?.syncTooltips}
              >
                <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
                  <div className="px-4 py-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <DashboardIcon
                        icon={dashboard.icon}
                        iconUrl={dashboard.icon_url}
                        size="lg"
                      />
                      <div>
                        <h1 className="font-semibold">{dashboard.name}</h1>
                      </div>
                    </div>
                    <RunComparePicker
                      timeRange={resolvedConfig.timeRange}
                      shareToken={token}
                      password={password || undefined}
                    />
                  </div>
                </header>
                <main className="p-4">
                  <DashboardGrid
                    config={resolvedConfig}
                    onConfigChange={() => {}}
                    isEditing={false}
                  />
                </main>
              </DashboardInteractionProvider>
            </DashboardStateProvider>
          </SharedTelemetryProvider>
        </SharedQueryProvider>
      )}
      <footer className="border-t mt-8 py-4">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          Shared via{" "}
          <a
            href="https://plexus.company"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Plexus
          </a>
          {" - "}HardwareOps. Ingest. Observe. Control.
        </div>
      </footer>
    </div>
  );
}
