/**
 * Source kinds — the enumerated vocabulary over `sources.device_type`.
 *
 * A kind is a descriptive label, not structure: it drives icons, templates,
 * and creation UX. The only structural split remains push vs pull (device vs
 * connection). `satellite` is the one kind with real behavior branching
 * (passive status, TLE stack) — the model for how a kind may earn behavior.
 *
 * Storage stays the existing `device_type` text column — no migration.
 * Creation validates against this registry; PATCH stays free-form for
 * forward-compat with external writers (e.g. server-side classification).
 */
import {
  Cpu,
  Terminal,
  Code2,
  Plug,
  Globe,
  Server,
  AppWindow,
  Timer,
  type LucideIcon,
} from "lucide-react";

export type SourceKindCategory = "hardware" | "software";

export interface SourceKind {
  /** The value stored in sources.device_type. */
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  category: SourceKindCategory;
  /** Default dashboard template id (lib/dashboards/templates.ts). */
  defaultTemplate?: string;
}

export const SOURCE_KINDS: SourceKind[] = [
  {
    id: "embedded",
    label: "Microcontroller",
    description: "ESP32, Arduino, or any HTTP-capable board",
    icon: Cpu,
    category: "hardware",
    defaultTemplate: "device-overview",
  },
  {
    id: "linux",
    label: "Linux device",
    description: "Raspberry Pi, Jetson, or any Linux host",
    icon: Terminal,
    category: "hardware",
    defaultTemplate: "device-overview",
  },
  {
    id: "script",
    label: "Python script",
    description: "Telemetry from a script or backend job",
    icon: Code2,
    category: "hardware",
    defaultTemplate: "device-overview",
  },
  {
    id: "http",
    label: "HTTP (generic)",
    description: "Any language — POST JSON to the gateway",
    icon: Plug,
    category: "hardware",
    defaultTemplate: "device-overview",
  },
  {
    id: "satellite",
    label: "Satellite",
    description: "Tracked by NORAD ID; orbit-derived context",
    icon: Globe,
    category: "hardware",
    defaultTemplate: "satellite-ops",
  },
  {
    id: "service",
    label: "Service / API",
    description: "Latency, errors, and throughput from a backend",
    icon: Server,
    category: "software",
    defaultTemplate: "service-health",
  },
  {
    id: "web-app",
    label: "Web app",
    description: "Product events from a site or frontend",
    icon: AppWindow,
    category: "software",
    defaultTemplate: "web-analytics",
  },
  {
    id: "worker",
    label: "Worker / cron",
    description: "Job runs, durations, and heartbeats",
    icon: Timer,
    category: "software",
    defaultTemplate: "service-health",
  },
];

export const SOURCE_KIND_IDS = SOURCE_KINDS.map((k) => k.id);

export function getSourceKind(
  id: string | null | undefined,
): SourceKind | undefined {
  return id ? SOURCE_KINDS.find((k) => k.id === id) : undefined;
}
