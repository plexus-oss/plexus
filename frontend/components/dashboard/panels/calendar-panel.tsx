"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  format,
  parseISO,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  subDays,
  formatDistanceToNow,
} from "date-fns";
import type { Panel, TimeRange } from "@/lib/types/dashboard";
import { usePanelData } from "@/hooks/use-panel-data";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { PanelEmptyState } from "@/components/dashboard/panels/panel-empty-state";
import {
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  X,
  CalendarDays,
} from "lucide-react";

interface CalendarPanelProps {
  panel: Panel;
  timeRange: TimeRange;
}

interface CalendarConfig {
  events?: CalendarEvent[];
  eventMetric?: string;
  dateMetric?: string;
  showEventCount?: boolean;
  highlightColor?: string;
  /** Month grid or GitHub-style activity heatmap. */
  view?: "month" | "heatmap";
  /** Heatmap range in weeks (default 26). */
  heatmapWeeks?: number;
}

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  color?: string;
  href?: string;
}

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Calendar Panel — responsive month grid or activity heatmap.
 */
export function CalendarPanel({ panel, timeRange }: CalendarPanelProps) {
  const config = panel.config as unknown as CalendarConfig;
  const view = config.view ?? "month";
  const heatmapWeeks = config.heatmapWeeks ?? 26;
  const highlight = config.highlightColor || "hsl(var(--primary))";

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  const { data, isLoading, error, sourceType, connectionMeta, refresh } =
    usePanelData({ panel, timeRange });

  const eventMetric = config.eventMetric || panel.metrics?.[0];
  const configEvents = config.events;

  const events = useMemo<CalendarEvent[]>(() => {
    if (configEvents && configEvents.length > 0) return configEvents;
    if (!data || !eventMetric) return [];

    const eventData = data[eventMetric] || [];
    // Fall back to the first metric that actually has data points.
    const sourceData =
      eventData.length > 0
        ? eventData
        : (data[
            Object.keys(data).find((key) => (data[key] || []).length > 0) ?? ""
          ] ?? []);

    return sourceData.map((point, index) => ({
      id: `${point.timestamp}-${index}`,
      title: String(point.value),
      date: point.timestamp,
    }));
  }, [configEvents, data, eventMetric]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      try {
        const key = format(parseISO(e.date), "yyyy-MM-dd");
        const list = map.get(key);
        if (list) list.push(e);
        else map.set(key, [e]);
      } catch {
        // ignore
      }
    }
    return map;
  }, [events]);

  const maxCount = useMemo(() => {
    let m = 0;
    eventsByDay.forEach((list) => {
      if (list.length > m) m = list.length;
    });
    return m;
  }, [eventsByDay]);

  const selectedEvents = useMemo(() => {
    if (!selectedDate) return [];
    const key = format(selectedDate, "yyyy-MM-dd");
    return eventsByDay.get(key) || [];
  }, [selectedDate, eventsByDay]);

  const handleSelect = useCallback((date: Date) => {
    setSelectedDate((prev) =>
      prev && isSameDay(prev, date) ? undefined : date,
    );
  }, []);

  // Dismiss drawer on Escape
  useEffect(() => {
    if (!selectedDate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedDate(undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedDate]);

  if (isLoading && events.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <PanelEmptyState
        reason="query_error"
        debugInfo={{
          sourceType,
          errorMessage: error instanceof Error ? error.message : String(error),
        }}
        onRetry={refresh}
      />
    );
  }

  if (!isLoading && events.length === 0 && !config.events) {
    return (
      <PanelEmptyState
        reason="no_data"
        debugInfo={{
          sourceType,
          rowCount: connectionMeta?.rowCount || 0,
          columns: connectionMeta?.columns?.map((c) => c.name),
        }}
        onRetry={refresh}
      />
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header: month label + nav */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 shrink-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-medium text-foreground tabular-nums">
            {view === "heatmap"
              ? "Activity"
              : format(currentMonth, "MMMM yyyy")}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {events.length}
            <span className="text-muted-foreground/50 ml-0.5">
              event{events.length === 1 ? "" : "s"}
            </span>
          </span>
        </div>
        {view === "month" && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
              aria-label="Previous month"
              className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setCurrentMonth(new Date());
                setSelectedDate(new Date());
              }}
              className="px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
              className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {view === "heatmap" ? (
        <HeatmapGrid
          weeks={heatmapWeeks}
          eventsByDay={eventsByDay}
          maxCount={maxCount}
          selectedDate={selectedDate}
          onSelect={handleSelect}
          highlight={highlight}
        />
      ) : (
        <MonthGrid
          currentMonth={currentMonth}
          eventsByDay={eventsByDay}
          selectedDate={selectedDate}
          onSelect={handleSelect}
          highlight={highlight}
        />
      )}

      {/* Selected day drawer — proportional height, animated entry */}
      {selectedDate && (
        <div
          key={format(selectedDate, "yyyy-MM-dd")}
          className={cn(
            "shrink-0 flex flex-col min-h-0",
            "border-t border-border/60 bg-background/60 backdrop-blur-sm",
            "animate-in slide-in-from-bottom-2 fade-in duration-200",
          )}
          style={{ maxHeight: "50%" }}
        >
          {/* Header */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border/40">
            <CalendarDays className="h-3 w-3 text-muted-foreground/60 shrink-0" />
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[11px] font-medium text-foreground truncate">
                {format(selectedDate, "EEEE")}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                {format(selectedDate, "MMM d")}
              </span>
              {isToday(selectedDate) && (
                <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-500/90">
                  today
                </span>
              )}
            </div>
            <div className="flex-1" />
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
              {selectedEvents.length}
              <span className="text-muted-foreground/50 ml-0.5">
                {selectedEvents.length === 1 ? "event" : "events"}
              </span>
            </span>
            <button
              onClick={() => setSelectedDate(undefined)}
              aria-label="Close"
              className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-auto">
            {selectedEvents.length === 0 ? (
              <div className="h-full min-h-[80px] flex flex-col items-center justify-center gap-1 px-3 py-4">
                <CalendarDays className="h-5 w-5 text-muted-foreground/30" />
                <span className="text-[11px] text-muted-foreground/60">
                  Nothing scheduled
                </span>
              </div>
            ) : (
              <div className="relative py-1">
                <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border/50 pointer-events-none" />
                {selectedEvents.map((event) => {
                  const color =
                    event.color || config.highlightColor || highlight;
                  const interactive = Boolean(event.href);
                  const date = parseISO(event.date);
                  return (
                    <div
                      key={event.id}
                      onClick={() => {
                        if (event.href) window.open(event.href, "_blank");
                      }}
                      className={cn(
                        "group flex items-center gap-2.5 px-3 h-[30px]",
                        "hover:bg-muted/40 transition-colors",
                        interactive && "cursor-pointer",
                      )}
                    >
                      <div
                        className="w-1.5 h-1.5 rounded-full shrink-0 ring-[3px] ring-background relative z-[1]"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-[12px] text-foreground truncate flex-1">
                        {event.title}
                      </span>
                      <span
                        className="text-[10px] font-mono text-muted-foreground/50 tabular-nums shrink-0 hidden sm:inline"
                        title={format(date, "yyyy-MM-dd HH:mm:ss")}
                      >
                        {formatDistanceToNow(date, { addSuffix: true })}
                      </span>
                      <span
                        className="text-[10px] font-mono text-muted-foreground/80 tabular-nums shrink-0"
                        title={format(date, "yyyy-MM-dd HH:mm:ss")}
                      >
                        {format(date, "HH:mm")}
                      </span>
                      {interactive && (
                        <ArrowUpRight className="h-3 w-3 text-muted-foreground/50 group-hover:text-foreground shrink-0 transition-colors" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer: jump-to-events link */}
          {selectedEvents.length > 0 && (
            <Link
              href={`/events?startTime=${format(selectedDate, "yyyy-MM-dd")}T00:00:00&endTime=${format(selectedDate, "yyyy-MM-dd")}T23:59:59`}
              className="shrink-0 flex items-center justify-between px-3 py-1.5 border-t border-border/40 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <span>View this day in events</span>
              <ArrowUpRight className="h-2.5 w-2.5" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Month grid — fills container width, cells flex to available space.
// ─────────────────────────────────────────────────────────────────────────────

function MonthGrid({
  currentMonth,
  eventsByDay,
  selectedDate,
  onSelect,
  highlight,
}: {
  currentMonth: Date;
  eventsByDay: Map<string, CalendarEvent[]>;
  selectedDate: Date | undefined;
  onSelect: (d: Date) => void;
  highlight: string;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  return (
    <div className="flex-1 flex flex-col min-h-0 p-1">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 shrink-0">
        {DOW.map((d, i) => (
          <div
            key={i}
            className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60 text-center py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div
        className="flex-1 grid grid-cols-7 gap-px min-h-0"
        style={{
          gridTemplateRows: `repeat(${Math.ceil(days.length / 7)}, minmax(0, 1fr))`,
        }}
      >
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(key) || [];
          const inMonth = isSameMonth(day, currentMonth);
          const today = isToday(day);
          const selected = selectedDate && isSameDay(day, selectedDate);
          const count = dayEvents.length;

          return (
            <button
              key={key}
              onClick={() => onSelect(day)}
              className={cn(
                "group relative flex flex-col items-stretch p-1 rounded-sm text-left min-h-0 overflow-hidden",
                "transition-colors",
                inMonth
                  ? "hover:bg-muted/50"
                  : "hover:bg-muted/30 opacity-40",
                selected && "bg-muted ring-1 ring-ring",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={cn(
                    "text-[10px] font-mono tabular-nums leading-none",
                    today
                      ? "text-foreground font-semibold"
                      : inMonth
                        ? "text-foreground/80"
                        : "text-muted-foreground/60",
                  )}
                >
                  {today ? (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-foreground text-background">
                      {format(day, "d")}
                    </span>
                  ) : (
                    format(day, "d")
                  )}
                </span>
                {count > 2 && (
                  <span className="text-[8px] font-mono text-muted-foreground/70 tabular-nums">
                    {count}
                  </span>
                )}
              </div>

              {/* Event bars — up to 2 visible, rest summarized above */}
              {count > 0 && (
                <div className="mt-auto flex flex-col gap-0.5 pt-0.5">
                  {dayEvents.slice(0, 2).map((e) => (
                    <div
                      key={e.id}
                      className="h-1 rounded-sm"
                      style={{ backgroundColor: e.color || highlight }}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Heatmap grid — GitHub contrib-style activity density, N weeks back from today.
// ─────────────────────────────────────────────────────────────────────────────

function HeatmapGrid({
  weeks,
  eventsByDay,
  maxCount,
  selectedDate,
  onSelect,
  highlight,
}: {
  weeks: number;
  eventsByDay: Map<string, CalendarEvent[]>;
  maxCount: number;
  selectedDate: Date | undefined;
  onSelect: (d: Date) => void;
  highlight: string;
}) {
  const days = useMemo(() => {
    const end = endOfWeek(new Date());
    const start = subDays(end, weeks * 7 - 1);
    return eachDayOfInterval({ start, end });
  }, [weeks]);

  // Column-major: weeks × 7 days
  const columns: Date[][] = useMemo(() => {
    const cols: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      cols.push(days.slice(i, i + 7));
    }
    return cols;
  }, [days]);

  const intensity = (n: number) => {
    if (n === 0) return 0;
    if (maxCount <= 1) return 1;
    return Math.min(1, 0.25 + (n / maxCount) * 0.75);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-2 overflow-auto">
      <div
        className="grid gap-[2px] min-w-0"
        style={{
          gridTemplateColumns: `repeat(${columns.length}, minmax(8px, 1fr))`,
          gridAutoRows: "minmax(8px, 1fr)",
          aspectRatio: `${columns.length} / 7`,
        }}
      >
        {columns.flatMap((col) =>
          col.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const list = eventsByDay.get(key) || [];
            const n = list.length;
            const opacity = intensity(n);
            const selected = selectedDate && isSameDay(day, selectedDate);
            const today = isToday(day);
            return (
              <button
                key={key}
                onClick={() => onSelect(day)}
                title={`${format(day, "MMM d, yyyy")} — ${n} event${n === 1 ? "" : "s"}${n > 0 ? `, ${formatDistanceToNow(day, { addSuffix: true })}` : ""}`}
                className={cn(
                  "rounded-[2px] transition-all relative",
                  n === 0 && "bg-muted/40 hover:bg-muted/60",
                  selected && "ring-1 ring-ring",
                  today && !selected && "ring-1 ring-border",
                )}
                style={
                  n > 0
                    ? {
                        backgroundColor: highlight,
                        opacity,
                      }
                    : undefined
                }
              />
            );
          }),
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1 mt-2 text-[9px] font-mono text-muted-foreground/60 shrink-0">
        <span>less</span>
        {[0, 0.35, 0.6, 0.85].map((o) => (
          <div
            key={o}
            className="w-2 h-2 rounded-[2px]"
            style={
              o === 0
                ? { backgroundColor: "hsl(var(--muted))" }
                : { backgroundColor: highlight, opacity: o }
            }
          />
        ))}
        <span>more</span>
      </div>
    </div>
  );
}
