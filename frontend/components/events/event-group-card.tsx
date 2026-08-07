"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { EventGroup } from "@/lib/events/group-events";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  success: "bg-green-500",
  info: "bg-gray-400",
};

export function EventGroupCard({ group }: { group: EventGroup }) {
  const [expanded, setExpanded] = useState(false);
  const isSingle = group.events.length === 1;
  const firstEvent = group.events[0];

  if (isSingle) {
    return (
      <div className="flex items-start gap-3 px-4 py-2.5">
        <div
          className={cn(
            "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
            SEVERITY_COLOR[firstEvent.severity] || "bg-gray-400",
          )}
        />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate">
            {firstEvent.title}
          </span>
          {firstEvent.source_name && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {firstEvent.source_name}
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
          {formatDistanceToNow(new Date(firstEvent.created_at), {
            addSuffix: true,
          })}
        </span>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 px-4 py-2.5 w-full text-left hover:bg-muted/50 transition-colors"
      >
        <div
          className={cn(
            "w-2 h-2 rounded-full flex-shrink-0",
            SEVERITY_COLOR[group.severity] || "bg-gray-400",
          )}
        />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {group.sourceName && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">
              {group.sourceName}
            </span>
          )}
          <span className="text-sm font-medium">
            {group.events.length} events
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
          {formatDistanceToNow(new Date(group.timeRange.start), {
            addSuffix: true,
          })}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <div className="pl-9 pr-4 pb-2 space-y-1">
          {group.events.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-2 py-1 border-l-2 border-border pl-3"
            >
              <div
                className={cn(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  SEVERITY_COLOR[event.severity] || "bg-gray-400",
                )}
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
      )}
    </div>
  );
}
