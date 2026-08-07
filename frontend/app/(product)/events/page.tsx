"use client";

/**
 * System Events Page
 *
 * Read-only activity feed of all platform events.
 * Supports full-text search, category/severity filters, and time range.
 */

import { useState, useMemo, useCallback, createElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageWrapper } from "@/components/ui/page-wrapper";
import {
  Activity,
  Search,
  X,
  ArrowRight,
  Server,
  AlertTriangle,
  Database,
  LayoutDashboard,
  Webhook,
  Plug,
  Key,
  Users,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import {
  useSystemEvents,
  type SystemEventFilters,
  type ActorMap,
} from "@/hooks/use-system-events";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { format, subHours, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { SystemEvent } from "@/lib/db/types";

// =============================================================================
// CONSTANTS
// =============================================================================

const CATEGORIES = [
  { value: "device", label: "Device", icon: Server },
  { value: "alert", label: "Alert", icon: AlertTriangle },
  { value: "source", label: "Data Connection", icon: Database },
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { value: "webhook", label: "Webhook", icon: Webhook },
  { value: "integration", label: "Integration", icon: Plug },
  { value: "api_key", label: "API Key", icon: Key },
  { value: "group", label: "Group", icon: Users },
] as const;

const SEVERITIES = [
  {
    value: "info",
    label: "Info",
    color: "bg-gray-400",
    text: "text-gray-600 dark:text-gray-400",
  },
  {
    value: "success",
    label: "Success",
    color: "bg-green-500",
    text: "text-green-600 dark:text-green-400",
  },
  {
    value: "warning",
    label: "Warning",
    color: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  {
    value: "critical",
    label: "Critical",
    color: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
  },
] as const;

const TIME_RANGES = [
  { label: "1h", value: 1 },
  { label: "6h", value: 6 },
  { label: "24h", value: 24 },
  { label: "7d", value: 168 },
  { label: "30d", value: 720 },
  { label: "All", value: 0 },
] as const;

function getCategoryIcon(category: string) {
  const found = CATEGORIES.find((c) => c.value === category);
  return found?.icon || Activity;
}

function getSeverityColor(severity: string) {
  const found = SEVERITIES.find((s) => s.value === severity);
  return found?.color || "bg-gray-400";
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function EventsPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(
    new Set(),
  );
  const [timeRangeHours, setTimeRangeHours] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState<SystemEvent | null>(null);

  // Debounce search
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(
    null,
  );
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceTimer) clearTimeout(debounceTimer);
      const timer = setTimeout(() => setDebouncedSearch(value), 300);
      setDebounceTimer(timer);
    },
    [debounceTimer],
  );

  const filters = useMemo((): SystemEventFilters => {
    const f: SystemEventFilters = { limit: 100 };
    if (selectedCategories.size === 1) {
      f.category = [...selectedCategories][0];
    }
    if (selectedSeverities.size === 1) {
      f.severity = [...selectedSeverities][0];
    }
    if (debouncedSearch) {
      f.search = debouncedSearch;
    }
    if (timeRangeHours > 0) {
      const now = new Date();
      f.startTime =
        timeRangeHours >= 24
          ? subDays(now, timeRangeHours / 24).toISOString()
          : subHours(now, timeRangeHours).toISOString();
    }
    return f;
  }, [selectedCategories, selectedSeverities, debouncedSearch, timeRangeHours]);

  const { events, total, actors, isLoading } = useSystemEvents(filters);

  // Client-side multi-filter (API only supports single category/severity)
  const filteredEvents = useMemo(() => {
    let result = events;
    if (selectedCategories.size > 1) {
      result = result.filter((e) => selectedCategories.has(e.category));
    }
    if (selectedSeverities.size > 1) {
      result = result.filter((e) => selectedSeverities.has(e.severity));
    }
    return result;
  }, [events, selectedCategories, selectedSeverities]);

  const { activeIndex, activeRef } = useListNavigation({
    items: filteredEvents,
    onSelect: (event) => setSelectedEvent(event),
    onOpen: (event) => setSelectedEvent(event),
    enabled: true,
  });

  const toggleCategory = useCallback((value: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  const toggleSeverity = useCallback((value: string) => {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  return (
    <PageWrapper title="Events" description="System activity feed">
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col overflow-hidden p-2">
          {/* Filters Bar */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-7 h-8 w-48"
              />
            </div>

            <div className="w-px h-5 bg-border" />

            {/* Category Chips */}
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const active = selectedCategories.has(cat.value);
              return (
                <Button
                  key={cat.value}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleCategory(cat.value)}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] h-auto",
                    active
                      ? "bg-foreground text-background border-foreground hover:bg-foreground/90"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/50",
                  )}
                >
                  <Icon className="h-2.5 w-2.5" />
                  {cat.label}
                </Button>
              );
            })}

            <div className="w-px h-5 bg-border" />

            {/* Severity Chips */}
            {SEVERITIES.map((sev) => {
              const active = selectedSeverities.has(sev.value);
              return (
                <Button
                  key={sev.value}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleSeverity(sev.value)}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] h-auto",
                    active
                      ? "bg-foreground text-background border-foreground hover:bg-foreground/90"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/50",
                  )}
                >
                  <div className={cn("w-1.5 h-1.5 rounded-full", sev.color)} />
                  {sev.label}
                </Button>
              );
            })}

            <div className="w-px h-5 bg-border" />

            {/* Time Range */}
            <div className="inline-flex items-center rounded-md border border-border">
              {TIME_RANGES.map((range) => (
                <Button
                  key={range.label}
                  variant="ghost"
                  size="sm"
                  onClick={() => setTimeRangeHours(range.value)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] rounded-none border-r last:border-r-0 border-border h-auto",
                    timeRangeHours === range.value
                      ? "bg-foreground text-background hover:bg-foreground/90"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {range.label}
                </Button>
              ))}
            </div>

            {/* Results count */}
            <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
              {total} event{total !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Main Content */}
          <div className="flex flex-1 gap-0 overflow-hidden relative">
            {/* Event List */}
            <Card className="flex-1 overflow-hidden">
              <div className="h-full overflow-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Spinner className="h-5 w-5 text-muted-foreground" />
                  </div>
                ) : filteredEvents.length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title="No events"
                    description={
                      debouncedSearch ||
                      selectedCategories.size > 0 ||
                      selectedSeverities.size > 0
                        ? "No events match your filters"
                        : "System events will appear here as activity occurs across your platform."
                    }
                    className="h-full"
                  />
                ) : (
                  <ul>
                    {filteredEvents.map((event, index) => {
                      const isSelected = selectedEvent?.id === event.id;
                      const isActive = activeIndex === index;
                      const CategoryIcon = getCategoryIcon(event.category);
                      const actor = event.actor_id
                        ? actors[event.actor_id]
                        : null;

                      return (
                        <li
                          key={event.id}
                          ref={
                            isActive
                              ? (activeRef as React.Ref<HTMLLIElement>)
                              : undefined
                          }
                          onClick={() => setSelectedEvent(event)}
                          className={cn(
                            "group flex items-center gap-2.5 px-3 h-9 cursor-pointer border-b border-border/40 text-[13px]",
                            isSelected
                              ? "bg-accent/60"
                              : isActive
                                ? "bg-muted/50"
                                : "hover:bg-muted/30",
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full flex-shrink-0",
                              getSeverityColor(event.severity),
                            )}
                          />
                          <CategoryIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          <span className="text-muted-foreground/70 text-[11px] font-mono capitalize w-16 flex-shrink-0 truncate">
                            {event.category}
                          </span>
                          <span className="font-medium text-foreground truncate flex-shrink-0 max-w-[38%]">
                            {event.title}
                          </span>
                          {event.description && (
                            <span className="text-muted-foreground truncate text-[12px] min-w-0">
                              {event.description}
                            </span>
                          )}
                          <div className="flex items-center gap-2.5 ml-auto flex-shrink-0 text-[11px] text-muted-foreground">
                            {event.source_name && (
                              <span className="truncate max-w-[140px]">
                                {event.source_name}
                              </span>
                            )}
                            {actor && (
                              // eslint-disable-next-line @next/next/no-img-element -- dynamic remote avatar URL not in next.config images
                              <img
                                src={actor.imageUrl}
                                alt={actor.name}
                                className="w-4 h-4 rounded-full"
                                title={actor.name}
                              />
                            )}
                            <span
                              className="tabular-nums w-36 text-right truncate font-mono"
                              title={`${format(new Date(event.created_at), "MMM d, yyyy 'at' h:mm:ss a")} (local)`}
                            >
                              {format(
                                new Date(event.created_at),
                                "MMM d, HH:mm:ss",
                              )}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>

            {/* Detail Panel */}
            <AnimatePresence mode="wait">
              {selectedEvent && (
                <EventDetailPanel
                  event={selectedEvent}
                  actors={actors}
                  onClose={() => setSelectedEvent(null)}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

// =============================================================================
// EVENT DETAIL PANEL
// =============================================================================

function EventDetailPanel({
  event,
  actors,
  onClose,
}: {
  event: SystemEvent;
  actors: ActorMap;
  onClose: () => void;
}) {
  const categoryIcon = getCategoryIcon(event.category);
  const severityInfo = SEVERITIES.find((s) => s.value === event.severity);
  const metadata =
    event.metadata &&
    typeof event.metadata === "object" &&
    !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : {};
  const metadataEntries = Object.entries(metadata).filter(
    ([, v]) => v !== null && v !== undefined,
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="absolute right-0 top-0 bottom-0 w-[480px] bg-background border-l flex flex-col z-30"
    >
      {/* Header */}
      <div className="flex-shrink-0 border-b">
        <div className="flex items-start justify-between p-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                event.severity === "critical"
                  ? "bg-red-500/10"
                  : event.severity === "warning"
                    ? "bg-amber-500/10"
                    : event.severity === "success"
                      ? "bg-green-500/10"
                      : "bg-muted",
              )}
            >
              {createElement(categoryIcon, { className: "h-4 w-4" })}
            </div>
            <div>
              <h2 className="font-semibold text-sm">{event.title}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border",
                    severityInfo?.text,
                  )}
                >
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      getSeverityColor(event.severity),
                    )}
                  />
                  {event.severity}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {format(
                    new Date(event.created_at),
                    "MMM d, yyyy 'at' h:mm:ss a",
                  )}
                </span>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        {event.description && (
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
              Description
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">
              {event.description}
            </p>
          </div>
        )}

        {/* Details Grid */}
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
            Details
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">Event Type</span>
              <div className="mt-0.5 font-mono text-[11px]">
                {event.event_type}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Category</span>
              <div className="mt-0.5 capitalize">{event.category}</div>
            </div>
            {event.source_name && (
              <div>
                <span className="text-muted-foreground">Source</span>
                <div className="mt-0.5">{event.source_name}</div>
              </div>
            )}
            {event.entity_type && (
              <div>
                <span className="text-muted-foreground">Entity Type</span>
                <div className="mt-0.5 capitalize">{event.entity_type}</div>
              </div>
            )}
            {event.actor_id && actors[event.actor_id] && (
              <div>
                <span className="text-muted-foreground">Actor</span>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- dynamic remote avatar URL not in next.config images */}
                  <img
                    src={actors[event.actor_id].imageUrl}
                    alt={actors[event.actor_id].name}
                    className="w-4 h-4 rounded-full"
                  />
                  <span>{actors[event.actor_id].name}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Links */}
        <div className="flex flex-wrap items-center gap-3">
          {event.source_slug && (
            <Link
              href={
                event.category === "device"
                  ? `/devices/${event.source_slug}`
                  : `/connections/${event.source_slug}`
              }
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              View Source
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          {event.entity_type === "alert" && event.entity_id && (
            <Link
              href={`/alerts`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <AlertTriangle className="h-3 w-3" />
              View Alerts
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          {event.entity_type === "dashboard" && event.entity_id && (
            <Link
              href={`/dashboards/${event.entity_id}`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LayoutDashboard className="h-3 w-3" />
              View Dashboard
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        {/* Metadata */}
        {metadataEntries.length > 0 && (
          <div className="pt-4 border-t border-border/50">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
              Metadata
            </div>
            <div className="space-y-1.5">
              {metadataEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-start justify-between text-xs gap-4"
                >
                  <span className="text-muted-foreground font-mono text-[11px] flex-shrink-0">
                    {key}
                  </span>
                  <span className="text-right truncate font-mono text-[11px]">
                    {typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
