import type { SystemEvent } from "@/lib/db/types";

export interface EventGroup {
  sourceSlug: string | null;
  sourceName: string | null;
  events: SystemEvent[];
  severity: string;
  timeRange: { start: string; end: string };
}

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function highestSeverity(events: SystemEvent[]): string {
  const order = ["critical", "warning", "success", "info"];
  for (const s of order) {
    if (events.some((e) => e.severity === s)) return s;
  }
  return "info";
}

/**
 * Groups events by source_slug within 5-minute windows.
 * Single events remain ungrouped (group with 1 event).
 */
export function groupEvents(events: SystemEvent[]): EventGroup[] {
  if (events.length === 0) return [];

  const groups: EventGroup[] = [];
  let current: SystemEvent[] = [events[0]];
  let currentSlug = events[0].source_slug ?? null;

  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    const slug = event.source_slug ?? null;
    const prevTime = new Date(current[current.length - 1].created_at).getTime();
    const thisTime = new Date(event.created_at).getTime();
    const gap = Math.abs(thisTime - prevTime);

    if (slug === currentSlug && gap <= WINDOW_MS) {
      current.push(event);
    } else {
      groups.push({
        sourceSlug: currentSlug,
        sourceName: current[0].source_name ?? null,
        events: current,
        severity: highestSeverity(current),
        timeRange: {
          start: current[0].created_at,
          end: current[current.length - 1].created_at,
        },
      });
      current = [event];
      currentSlug = slug;
    }
  }

  // Push last group
  groups.push({
    sourceSlug: currentSlug,
    sourceName: current[0].source_name ?? null,
    events: current,
    severity: highestSeverity(current),
    timeRange: {
      start: current[0].created_at,
      end: current[current.length - 1].created_at,
    },
  });

  return groups;
}
