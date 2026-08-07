"use client";

/**
 * Toolbar "Runs" navigator + n-run compare.
 *
 * Linear rules: one surface, two verbs, keyboard-first.
 *   · Click (or Enter) a run → OPEN it: the dashboard frames its window.
 *   · ⇄ (or Space) → OVERLAY it: the run joins the comparison set. Several
 *     runs can be overlaid; each gets one warm run color (orange, yellow,
 *     pink…) used for ALL its traces, its picker row, the chip, and every
 *     panel's mini-legend.
 *
 * The first overlay FRAMES the pair (absolute window showing both runs
 * aligned at T+0, anchored on the live run / the framed run / the most
 * recent run); later overlays join the same anchor. ✕ / Esc exits and
 * restores the exact prior view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, GitCompare, Play, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { useRuns, type Run } from "@/hooks/use-runs";
import {
  useDashboardInteraction,
  RUN_COMPARE_COLORS,
  type CompareRun,
} from "@/components/dashboard/dashboard-interaction-context";
import { getTimeRangeBounds, type TimeRange } from "@/lib/types/dashboard";
import { formatRelativeShort } from "@/lib/format/relative-time";
import { cn } from "@/lib/utils";

export function formatDuration(run: Run): string {
  if (!run.ended_at) return "live";
  const ms =
    new Date(run.ended_at).getTime() - new Date(run.started_at).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export const STATUS_DOT: Record<Run["status"], string> = {
  active: "bg-emerald-500 animate-pulse",
  completed: "bg-muted-foreground/50",
  aborted: "bg-red-500",
};

const ts = (iso: string) => new Date(iso).getTime();

interface RunComparePickerProps {
  timeRange: TimeRange;
  /** Present on shared dashboards — runs come from the token-scoped endpoint. */
  shareToken?: string;
  password?: string;
}

export function RunComparePicker({
  timeRange,
  shareToken,
  password,
}: RunComparePickerProps) {
  const { compareRuns, setCompareRuns, onTimeRangeChange } =
    useDashboardInteraction();
  const { runs, isLoading } = useRuns(
    shareToken
      ? {
          basePath: `/api/shared/${shareToken}/runs${
            password ? `?password=${encodeURIComponent(password)}` : ""
          }`,
        }
      : {},
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const router = useRouter();
  const searchParams = useSearchParams();
  // The view to restore when comparison fully exits (imperative one-shot).
  const preCompareRange = useRef<TimeRange | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((r) => r.name.toLowerCase().includes(q));
  }, [runs, query]);

  // Keep highlight within bounds as the list changes.
  const boundedHighlight = Math.min(highlight, Math.max(filtered.length - 1, 0));

  const syncUrl = useCallback(
    (ids: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (ids.length) params.set("compare", ids.join(","));
      else params.delete("compare");
      const qs = params.toString();
      // Native history API, NOT router.replace: this is pure URL state — a
      // router navigation re-fetches the route payload and flashes the route
      // loading UI, which reads as a full page reload just to toggle compare.
      // useSearchParams stays in sync with history.replaceState.
      window.history.replaceState(
        null,
        "",
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
      );
    },
    [searchParams],
  );

  /** Build a CompareRun; frames the view only for the FIRST baseline. */
  const buildComparison = useCallback(
    (
      baseline: Run,
      existing: CompareRun[],
    ): { compare: CompareRun; frame: TimeRange | null } => {
      const baselineStart = ts(baseline.started_at);
      const baselineEnd = baseline.ended_at
        ? ts(baseline.ended_at)
        : Date.now();
      const baselineDur = Math.max(baselineEnd - baselineStart, 1_000);
      const color =
        RUN_COMPARE_COLORS[existing.length % RUN_COMPARE_COLORS.length];

      // Later baselines join the established anchor.
      if (existing.length > 0) {
        return {
          compare: {
            id: baseline.id,
            window: `${new Date(baselineStart).toISOString()}/${new Date(
              baselineEnd,
            ).toISOString()}`,
            label: baseline.name,
            startedAt: baselineStart,
            alignTarget: existing[0].alignTarget,
            primaryLabel: existing[0].primaryLabel,
            sourceId: baseline.source_id,
            color,
          },
          frame: null,
        };
      }

      const others = runs.filter(
        (r) =>
          r.id !== baseline.id &&
          (!baseline.source_id ||
            !r.source_id ||
            r.source_id === baseline.source_id),
      );
      const activeRun = others.find((r) => r.status === "active");
      const bounds =
        timeRange.type === "absolute" ? getTimeRangeBounds(timeRange) : null;
      const framedRun = bounds
        ? others.find(
            (r) =>
              ts(r.started_at) < bounds.end.getTime() &&
              (!r.ended_at || ts(r.ended_at) > bounds.start.getTime()),
          )
        : undefined;
      const primary =
        activeRun ??
        framedRun ??
        others
          .filter((r) => r.ended_at)
          .sort((a, b) => ts(b.started_at) - ts(a.started_at))[0] ??
        null;

      let alignTarget: number;
      let frame: TimeRange | null = null;
      if (primary) {
        alignTarget = ts(primary.started_at);
        if (!activeRun) {
          const primaryEnd = primary.ended_at
            ? ts(primary.ended_at)
            : Date.now();
          const end = Math.max(primaryEnd, alignTarget + baselineDur);
          const pad = Math.max((end - alignTarget) * 0.05, 2_000);
          frame = {
            type: "absolute",
            value: `${new Date(alignTarget - pad).toISOString()}/${new Date(
              end + pad,
            ).toISOString()}`,
          };
        }
      } else if (timeRange.type === "absolute") {
        alignTarget = getTimeRangeBounds(timeRange).start.getTime();
      } else {
        alignTarget = Date.now() - baselineDur;
      }

      return {
        compare: {
          id: baseline.id,
          window: `${new Date(baselineStart).toISOString()}/${new Date(
            baselineEnd,
          ).toISOString()}`,
          label: baseline.name,
          startedAt: baselineStart,
          alignTarget,
          primaryLabel: primary?.name ?? null,
          sourceId: baseline.source_id,
          color,
        },
        frame,
      };
    },
    [runs, timeRange],
  );

  const clearAll = useCallback(() => {
    setCompareRuns([]);
    if (preCompareRange.current) {
      onTimeRangeChange(preCompareRange.current);
      preCompareRange.current = null;
    }
    syncUrl([]);
  }, [setCompareRuns, onTimeRangeChange, syncUrl]);

  /** Toggle a run in/out of the comparison set. */
  const toggle = useCallback(
    (run: Run) => {
      const existing = compareRuns;
      if (existing.some((r) => r.id === run.id)) {
        const next = existing
          .filter((r) => r.id !== run.id)
          // Recolor by position so colors stay stable-by-order.
          .map((r, i) => ({
            ...r,
            color: RUN_COMPARE_COLORS[i % RUN_COMPARE_COLORS.length],
          }));
        if (next.length === 0) {
          clearAll();
          return;
        }
        setCompareRuns(next);
        syncUrl(next.map((r) => r.id));
        return;
      }
      const { compare, frame } = buildComparison(run, existing);
      if (frame) {
        if (!preCompareRange.current) preCompareRange.current = timeRange;
        onTimeRangeChange(frame);
      }
      const next = [...existing, compare];
      setCompareRuns(next);
      syncUrl(next.map((r) => r.id));
    },
    [
      compareRuns,
      buildComparison,
      clearAll,
      setCompareRuns,
      syncUrl,
      timeRange,
      onTimeRangeChange,
    ],
  );

  /** Open (frame) a run: jump the dashboard to its window. No overlay. */
  const openRun = useCallback(
    (run: Run) => {
      const start = ts(run.started_at);
      const end = run.ended_at ? ts(run.ended_at) : Date.now();
      const pad = Math.max((end - start) * 0.05, 2_000);
      onTimeRangeChange({
        type: "absolute",
        value: `${new Date(start - pad).toISOString()}/${new Date(
          end + pad,
        ).toISOString()}`,
      });
      setOpen(false);
      setQuery("");
    },
    [onTimeRangeChange],
  );

  // ?compare=<id[,id2…]> deep link — restore (and frame) once runs arrive.
  const compareParam = searchParams.get("compare");
  useEffect(() => {
    if (!compareParam || compareRuns.length > 0 || runs.length === 0) return;
    const ids = compareParam.split(",").filter(Boolean);
    let acc: CompareRun[] = [];
    let firstFrame: TimeRange | null = null;
    for (const rid of ids) {
      const run = runs.find((r) => r.id === rid);
      if (!run) continue;
      const { compare, frame } = buildComparison(run, acc);
      if (frame && !firstFrame) firstFrame = frame;
      acc = [...acc, compare];
    }
    if (acc.length === 0) return;
    if (firstFrame) {
      if (!preCompareRange.current) preCompareRange.current = timeRange;
      onTimeRangeChange(firstFrame);
    }
    setCompareRuns(acc);
  }, [
    compareParam,
    compareRuns.length,
    runs,
    buildComparison,
    timeRange,
    onTimeRangeChange,
    setCompareRuns,
  ]);

  // Esc exits compare mode (ignored while typing in a field).
  useEffect(() => {
    if (compareRuns.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      clearAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compareRuns.length, clearAll]);

  // Keyboard navigation inside the popover (Linear-style).
  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const run = filtered[boundedHighlight];
        if (run) openRun(run);
      } else if (e.key === " " && filtered[boundedHighlight]) {
        e.preventDefault();
        toggle(filtered[boundedHighlight]);
      }
    },
    [filtered, boundedHighlight, openRun, toggle],
  );

  const hasActive = runs.some((r) => r.status === "active");
  const chipLabel = useMemo(() => {
    if (compareRuns.length === 0) return null;
    const first = compareRuns[0];
    const extra = compareRuns.length - 1;
    return {
      primary: first.primaryLabel,
      baseline: first.label,
      extra,
    };
  }, [compareRuns]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {chipLabel ? (
          <button
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium border border-dashed border-orange-500/50 bg-orange-500/10 text-foreground transition-colors hover:bg-orange-500/15"
            title={`Comparing ${chipLabel.primary ?? "current view"} against ${compareRuns
              .map((r) => r.label)
              .join(", ")} — Esc to exit`}
          >
            <GitCompare className="h-3 w-3 shrink-0 opacity-70" />
            <span className="truncate max-w-[280px]">
              {chipLabel.primary ? (
                <>
                  {chipLabel.primary}
                  <span className="text-muted-foreground px-1">vs</span>
                  {chipLabel.baseline}
                </>
              ) : (
                <>
                  <span className="text-muted-foreground pr-1">vs</span>
                  {chipLabel.baseline}
                </>
              )}
              {chipLabel.extra > 0 && (
                <span className="text-muted-foreground"> +{chipLabel.extra}</span>
              )}
            </span>
            <span
              role="button"
              aria-label="Exit comparison"
              className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground gap-1.5"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Runs</span>
            {hasActive && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-80 p-0"
        onKeyDown={onListKeyDown}
      >
        <div className="px-3 pt-2.5 pb-2 border-b border-border space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Test runs
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              placeholder="Search runs…"
              className="h-7 pl-7 text-[11px]"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {!shareToken && (
            <button
              onClick={() => {
                setOpen(false);
                router.push("/runs?new=1");
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-medium text-foreground hover:bg-muted/60 transition-colors border-b border-border/50"
            >
              <Play className="h-3 w-3" />
              Start a run
            </button>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Spinner className="h-3 w-3" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-4 text-[11px] text-muted-foreground">
              {query
                ? `No matches for "${query}"`
                : "No runs yet — start one above, from a test script via the API, or save a time range as a run."}
            </p>
          ) : (
            filtered.map((run, i) => {
              const selected = compareRuns.find((r) => r.id === run.id);
              const isHighlighted = i === boundedHighlight;
              return (
                <div
                  key={run.id}
                  className={cn(
                    "group/run flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors cursor-pointer",
                    isHighlighted && "bg-accent/50",
                    selected && "bg-foreground/5",
                    !isHighlighted && !selected && "hover:bg-muted/60",
                  )}
                  onClick={() => openRun(run)}
                  onMouseEnter={() => setHighlight(i)}
                  role="button"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      STATUS_DOT[run.status],
                    )}
                    style={
                      selected ? { backgroundColor: selected.color } : undefined
                    }
                  />
                  <span className="truncate flex-1 font-medium">
                    {run.name}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                    {formatDuration(run)}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatRelativeShort(new Date(run.started_at))}
                  </span>
                  <button
                    aria-label={
                      selected
                        ? `Remove ${run.name} from comparison`
                        : `Overlay ${run.name} on the current view`
                    }
                    title={selected ? "Remove from comparison" : "Overlay"}
                    className={cn(
                      "shrink-0 rounded p-0.5 transition-all",
                      selected
                        ? ""
                        : "opacity-0 group-hover/run:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                    style={selected ? { color: selected.color } : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(run);
                    }}
                  >
                    <GitCompare className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground flex items-center justify-between gap-2">
          <span>
            <kbd className="font-mono">↵</kbd> open ·{" "}
            <kbd className="font-mono">space</kbd> overlay
            {compareRuns.length > 0 && (
              <>
                {" "}
                · <kbd className="font-mono">esc</kbd> exit
              </>
            )}
          </span>
          {!shareToken && (
            <a
              href={
                compareRuns.length > 0
                  ? `/runs/compare?vs=${compareRuns[0].id}`
                  : "/runs/compare"
              }
              className="shrink-0 text-foreground/70 hover:text-foreground transition-colors"
            >
              Full compare view →
            </a>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
