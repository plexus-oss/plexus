"use client";

import { formatDistanceToNow } from "date-fns";
import { useSystemEvents } from "@/hooks/use-system-events";

function getSeverityColor(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-red-500";
    case "warning":
      return "bg-amber-500";
    case "success":
      return "bg-green-500";
    default:
      return "bg-gray-400";
  }
}

export function ActivityFeed() {
  const { events } = useSystemEvents({ limit: 8 });

  if (events.length === 0) return null;

  // Group consecutive events by source
  const groups: { sourceName: string | null; events: typeof events }[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.sourceName === (event.source_name ?? null) &&
      last.events.length < 3
    ) {
      last.events.push(event);
    } else {
      groups.push({
        sourceName: event.source_name ?? null,
        events: [event],
      });
    }
  }

  return (
    <div className="rounded-lg border divide-y">
      {groups.map((group) => {
        const firstEvent = group.events[0];
        if (group.events.length === 1) {
          return (
            <div key={firstEvent.id} className="flex items-center gap-3 p-3">
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${getSeverityColor(firstEvent.severity)}`}
              />
              <span className="text-sm truncate flex-1">
                {firstEvent.title}
              </span>
              {firstEvent.source_name && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0 truncate max-w-32">
                  {firstEvent.source_name}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                {formatDistanceToNow(new Date(firstEvent.created_at), {
                  addSuffix: true,
                })}
              </span>
            </div>
          );
        }

        // Grouped events
        return (
          <div key={firstEvent.id} className="p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              {group.sourceName && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {group.sourceName}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {group.events.length} events
              </span>
            </div>
            {group.events.map((event) => (
              <div key={event.id} className="flex items-center gap-2 pl-1">
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getSeverityColor(event.severity)}`}
                />
                <span className="text-xs truncate flex-1 text-muted-foreground">
                  {event.title}
                </span>
                <span className="text-[10px] text-muted-foreground/60 tabular-nums flex-shrink-0">
                  {formatDistanceToNow(new Date(event.created_at), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
