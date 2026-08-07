/**
 * Dashboard templates — curated lenses over the quick-start builder.
 *
 * A template is data, not machinery: a name, a source-kind affinity, and a
 * metric-ordering lens applied before `buildPanels` lays the dashboard out.
 * Everything renders through the same pure builder the quick-start route and
 * the Terminal's dashboard proposals use, so previews and results stay
 * byte-identical across every entry point.
 */
import type { Panel } from "@/lib/types/dashboard";
import { buildPanels } from "./quick-start-layout";

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  /** Source-kind affinity (lib/sources/kinds.ts id) — drives default pick. */
  kind?: string;
  build: (metrics: string[], sourceId: string) => Panel[];
}

/**
 * Stable-partition metrics so those matching earlier lenses lead. buildPanels
 * keeps input order for equal tile priorities and for the line-chart rows, so
 * ordering is the template's lever.
 */
function orderBy(metrics: string[], lenses: RegExp[]): string[] {
  const buckets: string[][] = [...lenses.map(() => []), []];
  for (const m of metrics) {
    const i = lenses.findIndex((re) => re.test(m));
    buckets[i === -1 ? lenses.length : i].push(m);
  }
  return buckets.flat();
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: "device-overview",
    name: "Device overview",
    description: "Headline readings as stat tiles, trend lines below.",
    kind: "embedded",
    build: buildPanels,
  },
  {
    id: "service-health",
    name: "Service health",
    description: "Latency and errors first, throughput and the rest below.",
    kind: "service",
    build: (metrics, sourceId) =>
      buildPanels(
        orderBy(metrics, [
          /latency|_ms$|duration/i,
          /error|fail|5xx/i,
          /request|throughput|rps|_count$/i,
        ]),
        sourceId,
        { trendworthy: /error|fail|5xx|request|throughput|rps|_count$|queue|depth/i },
      ),
  },
  {
    id: "web-analytics",
    name: "Web analytics",
    description: "Signups and conversions first, then views and dwell time.",
    kind: "web-app",
    build: (metrics, sourceId) =>
      buildPanels(
        orderBy(metrics, [
          /signup|conversion|unlock|subscribe/i,
          /view|visit|session|click/i,
          /_seconds$|dwell|read/i,
        ]),
        sourceId,
        { trendworthy: /signup|conversion|unlock|view|visit|session|click|_seconds$|dwell|read/i },
      ),
  },
  {
    id: "satellite-ops",
    name: "Satellite ops",
    description: "Passes, link budget, and payload readings for a satellite.",
    kind: "satellite",
    build: (metrics, sourceId) =>
      buildPanels(
        orderBy(metrics, [/elevation|azimuth|range/i, /_dbm$|signal|snr/i]),
        sourceId,
        { trendworthy: /elevation|azimuth|range|_dbm$|signal|snr/i },
      ),
  },
];

export function getTemplate(id: string): DashboardTemplate | undefined {
  return DASHBOARD_TEMPLATES.find((t) => t.id === id);
}

/** The kind's default template, falling back to the generic device overview. */
export function defaultTemplateForKind(
  kind: string | null | undefined,
): DashboardTemplate {
  return (
    (kind && DASHBOARD_TEMPLATES.find((t) => t.kind === kind)) ||
    DASHBOARD_TEMPLATES[0]
  );
}
