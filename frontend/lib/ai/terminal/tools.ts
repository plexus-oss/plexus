/**
 * Plexus Terminal — tool definitions + dispatch for the action copilot.
 *
 * Read tools ground the agent (sources, metrics, real values); propose_* tools
 * render preview→Apply cards — the agent NEVER mutates, all writes happen via
 * the existing authenticated routes when the user clicks Apply. Every tool is
 * org-scoped via the ToolCtx; the model cannot reach another org's data.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { sourceQueries, sourceContextQueries } from "@/lib/db/queries/sources";
import { alertQueries } from "@/lib/db/queries/alerts";
import { findSourceByRef } from "@/lib/api/find-source";
import { summarizeSeries } from "@/lib/ai/label/prompt";
import {
  getSourceMetrics,
  queryTelemetryAdaptive,
  getMetricPercentiles,
} from "@/lib/db/clickhouse";
import { parseTimeRangeParam } from "@/lib/telemetry/time-range-param";
import {
  CONNECTION_TYPE_VALUES,
  connectionMeta,
} from "@/lib/connections/connection-meta";
import type { Panel } from "@/lib/types/dashboard";
import {
  buildPanels,
  buildOverlayPanels,
} from "@/lib/dashboards/quick-start-layout";

export interface ToolCtx {
  orgId: string;
  userId: string;
  orgRole: string | undefined;
}

export const TERMINAL_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_sources",
    description:
      "List the telemetry sources (devices/services) in the organization. Use this to discover what exists before building a dashboard or alert. Optional `search` filters by slug or name.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "optional slug/name filter" },
      },
    },
  },
  {
    name: "get_source_metrics",
    description:
      "List the metric names a source has reported (e.g. battery.voltage, cpu_percent). Call this before referencing any metric so you only use real ones — never invent metric names.",
    input_schema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "the source slug, e.g. drone-001",
        },
      },
      required: ["source"],
    },
  },
  {
    name: "show_metric",
    description:
      "Render a live chart of one metric inline in the conversation, using the real Plexus panel. Use this whenever the user wants to SEE a metric (e.g. 'show me battery voltage'). Verify the source + metric exist first with get_source_metrics.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "the source slug, e.g. drone-001" },
        metric: { type: "string", description: "the exact metric name, e.g. battery.voltage" },
        viz: {
          type: "string",
          enum: ["line", "stat"],
          description: "line for a time-series, stat for a single latest value (default line)",
        },
      },
      required: ["source", "metric"],
    },
  },
  {
    name: "propose_monitor",
    description:
      "Propose a threshold alert on a metric for the user to review and apply. Use when the user wants to be alerted/paged about a metric crossing a bound. Provide min and/or max (at least one) — use the bound the user states, or a sensible default if they don't give one. Verify the source + metric exist first. This does NOT create the alert — it shows the user a proposal they Apply.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "the source slug, e.g. drone-001" },
        metric: { type: "string", description: "the exact metric name, e.g. battery.voltage" },
        min: { type: "number", description: "alert when the value drops below this" },
        max: { type: "number", description: "alert when the value rises above this" },
        severity: { type: "string", enum: ["info", "warning", "critical"] },
        message: { type: "string", description: "short human-readable alert message" },
      },
      required: ["source", "metric"],
    },
  },
  {
    name: "propose_email_integration",
    description:
      "Propose an email integration that emails the user when alerts fire, for review and Apply. Use when the user wants email notifications about alerts. IMPORTANT: if they don't name a specific address, leave `email` blank — it defaults to their account email. Don't ask for their email. Fires on alert.triggered + alert.resolved by default.",
    input_schema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "ONLY if the user gives a different address than their account email",
        },
        events: {
          type: "array",
          items: { type: "string" },
          description: "alert event types to send (default alert.triggered, alert.resolved)",
        },
      },
    },
  },
  {
    name: "propose_offline_alert",
    description:
      "Propose a 'stream stopped' alert for the user to review and Apply: it fires when a source stops sending data for longer than the timeout, and resolves when data resumes. Use for requests like 'alert me when my wifi/source disconnects' or 'tell me if X goes offline'. Verify the source exists first.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "the source slug, e.g. wifi-router" },
        timeout_minutes: {
          type: "number",
          description: "minutes of silence before alerting (default 5)",
        },
        severity: { type: "string", enum: ["info", "warning", "critical"] },
        message: { type: "string" },
      },
      required: ["source"],
    },
  },
  {
    name: "propose_dashboard",
    description:
      "Propose a dashboard for the user to review and Apply. Plexus auto-builds the panels (stat tiles + time-series charts), so you only need the source(s) and an optional name. Pass ONE source in `sources` for a single-device dashboard, or SEVERAL sources to build ONE dashboard that OVERLAYS them — each metric shared across sources is plotted as a multi-series chart (e.g. battery_voltage from drone-001 + drone-002 on the same axis). Use the multi-source form whenever the user wants to compare or combine data from more than one device/service on one dashboard. Verify every source exists first. This does NOT create it — it shows a proposal the user Applies.",
    input_schema: {
      type: "object",
      properties: {
        sources: {
          type: "array",
          items: { type: "string" },
          description:
            "one or more source slugs to build the dashboard from, e.g. [\"drone-001\", \"drone-002\"]. Multiple sources overlay shared metrics on the same charts.",
        },
        source: {
          type: "string",
          description: "a single source slug — shorthand for sources: [source]",
        },
        name: { type: "string", description: "optional dashboard name" },
      },
    },
  },
  {
    name: "propose_create_source",
    description:
      "Propose creating a new device source (a thing that sends telemetry) for the user to review and Apply. Use when the user wants to add/register/create a new device or source. Pick the device_type that fits what they describe: 'microcontroller' (ESP32/Arduino/embedded board), 'linux' (Raspberry Pi or Linux host running the agent), 'python' (a script or backend job), 'http' (any language POSTing JSON), or 'empty' (a placeholder with no ingest yet). If they don't say, default to 'http'. The slug is the source's url-safe id (lowercase letters, numbers, dots, hyphens, underscores). This does NOT create it — it shows the user a proposal they Apply.",
    input_schema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description:
            "url-safe id for the source, lowercase, e.g. weather-station or drone-002",
        },
        name: { type: "string", description: "optional friendly name" },
        device_type: {
          type: "string",
          enum: ["microcontroller", "linux", "python", "http", "empty"],
          description: "the kind of device (default http)",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "propose_update_source",
    description:
      "Propose updating an existing device source's name, friendly description, or device_type, for the user to review and Apply. Use when the user wants to rename a device or change its type. Pass the slug plus only the fields that change. Verify the source exists first. This does NOT update anything — the user Applies it.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "the source slug to update, e.g. drone-001" },
        name: { type: "string", description: "new friendly name" },
        description: { type: "string", description: "new description" },
        device_type: {
          type: "string",
          enum: ["microcontroller", "linux", "python", "http", "empty"],
          description: "new device type",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "propose_delete_source",
    description:
      "Propose deleting a source — a device OR a connection — and all of its data, for the user to review and Apply. Destructive and irreversible. Use when the user explicitly wants to remove/delete a device or connection. Verify the slug exists first with list_sources. This does NOT delete anything — the user must click Apply to confirm.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "the slug of the device or connection to delete" },
      },
      required: ["slug"],
    },
  },
  {
    name: "propose_create_connection",
    description:
      "Propose connecting an external data source (a database or time-series backend) for the user to review and Apply. Supported connection_type values: postgres, timescaledb, mysql, clickhouse, influxdb, prometheus. Pick the one that matches what the user describes. IMPORTANT: do NOT ask for or accept a connection string, password, token, host, or any credential in the chat — the user enters the connection string securely on the Apply card. You only provide the type, a url-safe slug, and an optional name. This does NOT create anything — the user Applies it.",
    input_schema: {
      type: "object",
      properties: {
        connection_type: {
          type: "string",
          enum: [...CONNECTION_TYPE_VALUES],
          description: "the kind of data source to connect",
        },
        slug: {
          type: "string",
          description: "url-safe id for the connection, lowercase, e.g. prod-postgres",
        },
        name: { type: "string", description: "optional friendly name" },
      },
      required: ["connection_type", "slug"],
    },
  },
  {
    name: "propose_update_connection",
    description:
      "Propose updating an existing connection's name or description for the user to review and Apply. Use for renaming a connection. NOTE: changing credentials, host, or the connection string is NOT supported here — for that, tell the user to edit the connection in the Connections page. Verify the connection exists first. This does NOT update anything — the user Applies it.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "the connection slug to update" },
        name: { type: "string", description: "new friendly name" },
        description: { type: "string", description: "new description" },
      },
      required: ["slug"],
    },
  },
  {
    name: "query_metric",
    description:
      "Query the REAL values of one metric over a time range and get a compact statistical summary (latest, min, max, average, count, percentiles for longer ranges, and downsampled shape buckets) plus a few recent points. Use this to ANSWER questions about data — 'what's the battery on drone-001?', 'how high did the temperature get today?', 'is CPU usage normal?' — and to INVESTIGATE a specific window: pass absolute start/end (ISO 8601 or epoch ms) to query exactly that window, e.g. the window the user is looking at. Verify the source + metric exist first with get_source_metrics. For a visual chart instead, use show_metric.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "the source slug, e.g. drone-001" },
        metric: { type: "string", description: "the exact metric name, e.g. battery.voltage" },
        range: {
          type: "string",
          description: "relative time window: 5m, 15m, 1h, 6h, 24h, 7d, 30d (default 1h; ignored when start/end are given)",
        },
        start: {
          type: "string",
          description: "absolute window start — ISO 8601 timestamp or epoch milliseconds",
        },
        end: {
          type: "string",
          description: "absolute window end — ISO 8601 timestamp or epoch milliseconds",
        },
      },
      required: ["source", "metric"],
    },
  },
  {
    name: "get_source_context",
    description:
      "Read the user-maintained context items for a source: notes (with their full text), files, links, and saved model memories. Read this before explaining or annotating a source's data — the context often says what the hardware is and what 'normal' looks like.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "the source slug, e.g. drone-001" },
      },
      required: ["source"],
    },
  },
  {
    name: "propose_annotation",
    description:
      "Propose labeling a time window on a metric — an annotation drawn on the chart — for the user to review and Apply. Use when an investigation shows something notable in a window (a spike, drop, gap, oscillation). Times are epoch milliseconds UTC; omit end_ms for a single instant. Base the window and the note on real data you actually queried. This does NOT create the annotation — the user Applies it.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "the source slug, e.g. drone-001" },
        metric: { type: "string", description: "the exact metric name, e.g. battery.voltage" },
        start_ms: { type: "number", description: "window start, epoch milliseconds UTC" },
        end_ms: {
          type: "number",
          description: "window end, epoch milliseconds UTC (omit for a single instant)",
        },
        label: { type: "string", description: "short label, e.g. 'Voltage sag'" },
        note: {
          type: "string",
          description: "one-line note citing the series and values that support it",
        },
      },
      required: ["source", "metric", "start_ms", "label", "note"],
    },
  },
  {
    name: "propose_remember",
    description:
      "Propose saving a durable fact about a source to its context (a 'Model memory' note) for the user to review and Apply. Only for facts strongly supported by data you actually queried (e.g. a recurring baseline), never speculation. Applied memories are retrieved into future analysis of the source. This does NOT save anything — the user Applies it.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "the source slug the fact is about" },
        content: {
          type: "string",
          description: "the durable fact to remember — one or two sentences",
        },
      },
      required: ["source", "content"],
    },
  },
  {
    name: "get_fleet_status",
    description:
      "Get a snapshot of the whole fleet: every source with its online/offline status and type, plus open/acknowledged/resolved alert counts. Use to answer 'how's my fleet?', 'what's online?', 'any problems?'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_alerts",
    description:
      "List alerts in the org with their source, metric, severity, status, and trigger value. Use to answer 'what alerts are firing?', 'any open alerts on drone-001?'. Defaults to open alerts.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "acknowledged", "resolved"],
          description: "filter by status (default open)",
        },
        source: { type: "string", description: "optional source slug to filter by" },
        limit: { type: "number", description: "max alerts to return (default 50)" },
      },
    },
  },
];

/** A proposal the Terminal shows the user to review + Apply (preview→confirm). */
export interface TerminalProposal {
  kind:
    | "monitor"
    | "dashboard"
    | "integration"
    | "source"
    | "connection"
    | "annotation"
    | "memory";
  /** What Apply does. Drives the HTTP method (create→POST, update→PATCH,
   *  delete→DELETE) and the success copy. Defaults to "create". */
  action?: "create" | "update" | "delete";
  title: string;
  summary: string;
  endpoint: string;
  body: unknown;
  /** For `kind:"connection"` create — the type drives the connection-string
   *  input placeholder the Apply card renders. */
  connectionType?: string;
  /** `source:metric` keys rendered as live charts in the preview. */
  previewMetrics?: string[];
  /** For `kind:"dashboard"` — the exact Panel[] this proposal will create
   *  (from the shared quick-start layout), so the card renders a faithful
   *  mini-dashboard instead of an approximation. */
  previewPanels?: Panel[];
  /** Fallback link after Apply (a deep link is derived from the response when available). */
  appliedHref?: string;
  /** For annotation/memory proposals — ties Apply/Dismiss to the ai_label_runs
   *  row created when the tool was called, so /intelligence shows the human
   *  verdict next to what the model proposed (same flow as chart labeling). */
  verdict?: {
    runId: string;
    /** Index into the run's observations array. */
    index: number;
    kind: "label" | "remember";
    /** The proposal text the verdict route logs (label or memory content). */
    label: string;
    startMs?: number | null;
    endMs?: number | null;
  };
}

/** Friendly device_type → the value the API/device modal stores. Shared by the
 *  create + update source proposals. `empty` (placeholder) maps to undefined. */
const DEVICE_TYPE_MAP: Record<string, string | undefined> = {
  microcontroller: "embedded",
  linux: "linux",
  python: "script",
  http: "http",
  empty: undefined,
};

/** Build an email-integration proposal, bound to alert events. */
export function buildEmailProposal(input: unknown): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const email = String(a.email ?? "").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const events =
    Array.isArray(a.events) && a.events.length
      ? (a.events as string[])
      : ["alert.triggered", "alert.resolved"];
  return {
    kind: "integration",
    title: `Email alerts · ${email}`,
    summary: `Email ${email} on ${events
      .map((e) => e.replace("alert.", "").replace("device.", ""))
      .join(" + ")}.`,
    endpoint: "/api/integrations/email",
    appliedHref: "/alerts/integrations",
    body: { name: `Alerts → ${email}`, emailAddress: email, events },
  };
}

/**
 * Build a "create source" proposal. Mirrors the device modal's createSource
 * call exactly: POST /api/sources with source_type "device". Friendly type
 * names map to the real device_type the modal sends.
 */
export function buildSourceProposal(input: unknown): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const slug = String(a.slug ?? "")
    .trim()
    .toLowerCase();
  // Same charset the API enforces (SLUG_PATTERN in api-schemas.ts).
  if (!slug || !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) return null;
  const name = typeof a.name === "string" && a.name.trim() ? a.name.trim() : undefined;

  // Friendly type → the device_type value the device modal posts.
  const choice =
    typeof a.device_type === "string" && a.device_type in DEVICE_TYPE_MAP
      ? a.device_type
      : "http";
  const device_type = DEVICE_TYPE_MAP[choice];

  const LABELS: Record<string, string> = {
    microcontroller: "microcontroller (ESP32/Arduino)",
    linux: "Raspberry Pi / Linux",
    python: "Python script",
    http: "HTTP device",
    empty: "empty device",
  };

  return {
    kind: "source",
    action: "create",
    title: `Source · ${slug}`,
    summary: `Register ${LABELS[choice]}${name ? ` "${name}"` : ""} as a new source.`,
    endpoint: "/api/sources",
    appliedHref: `/devices/${slug}`,
    body: { source_type: "device", slug, name, device_type },
  };
}

/**
 * Build an "update source" (device) proposal. PATCHes /api/sources/{slug} with
 * the changed fields. Requires the slug plus at least one field to change.
 */
export function buildUpdateSourceProposal(input: unknown): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const slug = String(a.slug ?? "").trim().toLowerCase();
  if (!slug) return null;

  const body: Record<string, unknown> = { slug };
  const changes: string[] = [];

  if (typeof a.name === "string" && a.name.trim()) {
    body.name = a.name.trim();
    changes.push(`name → "${a.name.trim()}"`);
  }
  if (typeof a.description === "string" && a.description.trim()) {
    body.description = a.description.trim();
    changes.push("description");
  }
  if (typeof a.device_type === "string" && a.device_type in DEVICE_TYPE_MAP) {
    body.device_type = DEVICE_TYPE_MAP[a.device_type];
    changes.push(`type → ${a.device_type}`);
  }

  if (changes.length === 0) return null; // nothing to change

  return {
    kind: "source",
    action: "update",
    title: `Update · ${slug}`,
    summary: `Update ${slug}: ${changes.join(", ")}.`,
    endpoint: `/api/sources/${slug}`,
    appliedHref: `/devices/${slug}`,
    body,
  };
}

/**
 * Build a "delete source" proposal. Works for any source — device OR connection
 * — since both delete via DELETE /api/sources/{slug}. Destructive: the card
 * renders it in red and the user must click Apply to confirm.
 */
export function buildDeleteSourceProposal(input: unknown): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const slug = String(a.slug ?? "").trim().toLowerCase();
  if (!slug) return null;
  return {
    kind: "source",
    action: "delete",
    title: `Delete · ${slug}`,
    summary: `Permanently delete ${slug} and all of its data. This can't be undone.`,
    endpoint: `/api/sources/${slug}`,
    body: { slug },
  };
}

/**
 * Build a "create connection" proposal. The agent proposes the connection
 * SHAPE only (type + slug + name); the Apply card collects the connection
 * string (with credentials) client-side, so secrets never reach the model or
 * the conversation history. Apply POSTs to /api/sources as a connection.
 */
export function buildConnectionProposal(input: unknown): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const slug = String(a.slug ?? "").trim().toLowerCase();
  if (!slug || !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) return null;

  const type = String(a.connection_type ?? "").trim();
  const meta = connectionMeta(type);
  if (!meta) return null;

  const name = typeof a.name === "string" && a.name.trim() ? a.name.trim() : undefined;

  return {
    kind: "connection",
    action: "create",
    connectionType: type,
    title: `Connection · ${slug}`,
    summary: `Connect a ${meta.label} data source${name ? ` "${name}"` : ""}. Enter the connection string below to link it.`,
    endpoint: "/api/sources",
    appliedHref: "/connections",
    body: { source_type: "connection", connection_type: type, slug, name },
  };
}

/**
 * Build an "update connection" proposal — non-secret fields only (name,
 * description). Credential/host changes are not done here (they require a
 * re-test); the agent points those to the connections UI. PATCHes the source.
 */
export function buildUpdateConnectionProposal(input: unknown): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const slug = String(a.slug ?? "").trim().toLowerCase();
  if (!slug) return null;

  const body: Record<string, unknown> = { slug };
  const changes: string[] = [];
  if (typeof a.name === "string" && a.name.trim()) {
    body.name = a.name.trim();
    changes.push(`name → "${a.name.trim()}"`);
  }
  if (typeof a.description === "string" && a.description.trim()) {
    body.description = a.description.trim();
    changes.push("description");
  }
  if (changes.length === 0) return null;

  return {
    kind: "connection",
    action: "update",
    title: `Update · ${slug}`,
    summary: `Update connection ${slug}: ${changes.join(", ")}.`,
    endpoint: `/api/sources/${slug}`,
    appliedHref: "/connections",
    body,
  };
}

/** Epoch-ms parser tolerant of the forms a model produces: a number, a numeric
 *  string, or an ISO 8601 timestamp. Null when unparseable. */
export function parseEpochMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    if (/^\d{10,}$/.test(s)) return Number(s);
    const t = new Date(s).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Build an annotation proposal. Apply POSTs /api/annotations with EXACTLY the
 * body the chart labeling flow sends (label-proposals → useAnnotations
 * createAnnotation), so the chart overlay updates the same way. The verdict
 * linkage (ai_label_runs row) is attached by the route after it persists the
 * run.
 */
export function buildAnnotationProposal(input: unknown): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const source = String(a.source ?? "").trim();
  const metric = String(a.metric ?? "").trim();
  const label = String(a.label ?? "").trim().slice(0, 200);
  const startMs = parseEpochMs(a.start_ms);
  if (!source || !metric || !label || startMs === null) return null;
  const endParsed = parseEpochMs(a.end_ms);
  const endMs = endParsed !== null && endParsed > startMs ? endParsed : null;
  const note = typeof a.note === "string" && a.note.trim() ? a.note.trim() : null;
  return {
    kind: "annotation",
    title: `Annotation · ${label}`,
    summary: note ?? `Label this window on ${source}:${metric}.`,
    endpoint: "/api/annotations",
    previewMetrics: [`${source}:${metric}`],
    // Same shape label-proposals passes to createAnnotation.
    body: {
      source_id: source,
      timestamp_start: new Date(startMs).toISOString(),
      timestamp_end: endMs !== null ? new Date(endMs).toISOString() : null,
      label,
      color: "purple",
      notes: note,
    },
  };
}

/**
 * Build a "remember" (source memory) proposal. Apply POSTs the existing
 * source-context API as a note named "Model memory" — the exact request shape
 * label-proposals sends — so applied memories join the same retrieval pool.
 */
export function buildRememberProposal(input: unknown): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const source = String(a.source ?? "").trim();
  const content = String(a.content ?? "").trim();
  if (!source || !content) return null;
  return {
    kind: "memory",
    title: `Memory · ${source}`,
    summary: content,
    endpoint: `/api/sources/${source}/context`,
    body: { context_type: "note", name: "Model memory", content },
  };
}

/** Build a "stream stopped" (offline) alert proposal. */
export function buildOfflineProposal(input: unknown): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const source = String(a.source ?? "").trim();
  if (!source) return null;
  const minutes =
    typeof a.timeout_minutes === "number" && a.timeout_minutes > 0
      ? a.timeout_minutes
      : 5;
  const timeout_seconds = Math.round(minutes * 60);
  const severity =
    a.severity === "info" || a.severity === "critical" ? a.severity : "warning";
  const message = typeof a.message === "string" ? a.message : null;
  return {
    kind: "monitor",
    title: `Alert · ${source} · stream stopped`,
    summary: `${severity[0].toUpperCase()}${severity.slice(1)} when ${source} stops sending data for ${minutes} min — auto-resolves when it's back.`,
    endpoint: "/api/monitors",
    appliedHref: "/alerts/monitors",
    body: { source_id: source, offline: { timeout_seconds, severity, message } },
  };
}

/** Normalize the source list from the model's input (`sources` array and/or
 * the `source` shorthand). Deduped, trimmed, blanks dropped. */
export function dashboardSources(input: unknown): string[] {
  const a = (input ?? {}) as Record<string, unknown>;
  return Array.from(
    new Set(
      [...(Array.isArray(a.sources) ? a.sources : []), a.source ?? ""]
        .map((s) => String(s ?? "").trim())
        .filter(Boolean),
    ),
  );
}

/**
 * Build a dashboard proposal. Apply hits the quick-start builder.
 *  - one source  → a starter dashboard (stat tiles + charts).
 *  - many sources → one OVERLAY dashboard: shared metrics plotted as
 *    multi-series charts across the sources.
 * `metricsBySource` is the metrics each source actually reports (used for the
 * summary + live preview).
 */
export function buildDashboardProposal(
  input: unknown,
  metricsBySource: Record<string, string[]>,
): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const sources = dashboardSources(input);
  if (sources.length === 0) return null;
  const customName =
    typeof a.name === "string" && a.name.trim() ? a.name.trim() : null;

  // ── Single source: existing starter-dashboard behavior, unchanged. ──
  if (sources.length === 1) {
    const source = sources[0];
    const metrics = metricsBySource[source] ?? [];
    const name = customName ?? `${source} overview`;
    return {
      kind: "dashboard",
      title: `Dashboard · ${name}`,
      summary:
        metrics.length > 0
          ? `Auto-builds stat tiles + charts from ${source}'s ${metrics.length} metric${metrics.length === 1 ? "" : "s"}.`
          : `Builds a starter dashboard for ${source}.`,
      endpoint: "/api/dashboards/quick-start",
      appliedHref: "/dashboards",
      previewMetrics: metrics.slice(0, 2).map((m) => `${source}:${m}`),
      // The exact panels Apply will create — rendered as a mini-dashboard.
      previewPanels: buildPanels(metrics, source),
      body: { sourceId: source, name },
    };
  }

  // ── Multiple sources: an overlay dashboard. ──
  const name = customName ?? `${sources.join(" + ")} overlay`;
  // Mirror the route: overlay only the requested sources that actually report
  // metrics, then build the same panels the route will.
  const overlayMetrics: Record<string, string[]> = {};
  for (const s of sources) {
    const m = metricsBySource[s] ?? [];
    if (m.length > 0) overlayMetrics[s] = m;
  }
  const metricUnion = new Set(sources.flatMap((s) => metricsBySource[s] ?? []));
  // Preview the most-shared metric across sources — that's the overlay the
  // user is after. Show each source's series of it (up to 4).
  const shared = mostSharedMetric(metricsBySource, sources);
  const previewMetrics = shared
    ? sources
        .filter((s) => (metricsBySource[s] ?? []).includes(shared))
        .slice(0, 4)
        .map((s) => `${s}:${shared}`)
    : sources
        .map((s) => {
          const first = (metricsBySource[s] ?? [])[0];
          return first ? `${s}:${first}` : null;
        })
        .filter((m): m is string => m !== null)
        .slice(0, 4);
  return {
    kind: "dashboard",
    title: `Dashboard · ${name}`,
    summary:
      metricUnion.size > 0
        ? `Overlays ${metricUnion.size} metric${metricUnion.size === 1 ? "" : "s"} across ${sources.join(", ")} on shared charts.`
        : `Overlays ${sources.join(", ")} on one dashboard.`,
    endpoint: "/api/dashboards/quick-start",
    appliedHref: "/dashboards",
    previewMetrics,
    // The exact overlay panels Apply will create — rendered as a mini-dashboard.
    previewPanels: buildOverlayPanels(overlayMetrics),
    body: { sources, name },
  };
}

/** The metric reported by the most sources (≥2). Used to preview the overlay. */
function mostSharedMetric(
  metricsBySource: Record<string, string[]>,
  sources: string[],
): string | null {
  const counts = new Map<string, number>();
  for (const s of sources) {
    for (const m of metricsBySource[s] ?? []) {
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 1; // require shared by at least 2 sources
  for (const [m, c] of counts) {
    if (c > bestCount) {
      best = m;
      bestCount = c;
    }
  }
  return best;
}

/** Build a monitor (threshold alert) proposal from the model's tool input. */
export function buildMonitorProposal(input: unknown): TerminalProposal | null {
  const a = (input ?? {}) as Record<string, unknown>;
  const source = String(a.source ?? "").trim();
  const metric = String(a.metric ?? "").trim();
  if (!source || !metric) return null;
  const min = typeof a.min === "number" ? a.min : null;
  const max = typeof a.max === "number" ? a.max : null;
  if (min === null && max === null) return null;
  const severity =
    a.severity === "info" || a.severity === "critical" ? a.severity : "warning";
  const message = typeof a.message === "string" ? a.message : null;

  let cond: string;
  if (min !== null && max !== null) cond = `leaves ${min}–${max}`;
  else if (max !== null) cond = `goes above ${max}`;
  else cond = `drops below ${min}`;

  return {
    kind: "monitor",
    title: `Alert · ${source} · ${metric}`,
    summary: `${severity[0].toUpperCase()}${severity.slice(1)} when ${metric} ${cond}.`,
    endpoint: "/api/monitors",
    appliedHref: "/alerts/monitors",
    previewMetrics: [`${source}:${metric}`],
    body: { source_id: source, metric, threshold: { min, max, severity, message } },
  };
}

/**
 * Build a real dashboard Panel for a single source:metric — used by the
 * `show_metric` tool to render live dynamic UI inline. Mirrors the shape the
 * quick-start dashboard builder emits.
 */
export function buildMetricPanel(
  source: string,
  metric: string,
  viz: "line" | "stat",
  idSuffix: string,
): Panel {
  return {
    id: `term-${idSuffix}`,
    type: viz === "stat" ? "stat" : "line",
    title: `${source} · ${metric}`,
    metrics: [`${source}:${metric}`],
    sources: [source],
    dataSource: { type: "realtime" },
    config: { aggregation: "last", showLegend: false },
    layout: { x: 0, y: 0, w: 24, h: 6 },
  } as Panel;
}

export async function runTool(
  name: string,
  input: unknown,
  ctx: ToolCtx,
): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "list_sources": {
      const search =
        typeof args.search === "string" && args.search.trim()
          ? { search: args.search.trim() }
          : undefined;
      const sources = await sourceQueries.findAllFiltered(ctx.orgId, search);
      return sources.slice(0, 200).map((s) => ({
        slug: s.slug,
        name: s.name,
        status: s.status,
        type: s.source_type,
      }));
    }
    case "get_source_metrics": {
      const slug = String(args.source ?? "").trim();
      if (!slug) return { error: "source is required" };
      const metrics = await getSourceMetrics(ctx.orgId, slug);
      return { source: slug, metrics };
    }
    case "get_source_context": {
      const slug = String(args.source ?? "").trim();
      if (!slug) return { error: "source is required" };
      const src = await findSourceByRef(ctx.orgId, slug, false);
      if (!src) return { error: `unknown source: ${slug}` };
      const rows = await sourceContextQueries.findBySource(ctx.orgId, src.id);
      // Notes carry their text body; file/link items contribute name +
      // description only — same rule the labeling prompt applies.
      return {
        source: slug,
        items: rows.slice(0, 50).map((c) => ({
          type: c.context_type,
          name: c.name,
          description: c.description,
          content:
            c.context_type === "note" ? (c.content ?? "").slice(0, 4000) : null,
          created_at: c.created_at,
        })),
      };
    }
    case "query_metric": {
      const source = String(args.source ?? "").trim();
      const metric = String(args.metric ?? "").trim();
      if (!source || !metric) return { error: "source and metric are required" };
      // Absolute window (ISO or epoch ms) wins over the relative range.
      const absStart = parseEpochMs(args.start);
      const absEnd = parseEpochMs(args.end);
      const absolute = absStart !== null && absEnd !== null && absEnd > absStart;
      const range = absolute
        ? `${new Date(absStart).toISOString()} – ${new Date(absEnd).toISOString()}`
        : typeof args.range === "string" && args.range.trim()
          ? args.range.trim()
          : "1h";
      const { startTime, endTime } = absolute
        ? { startTime: new Date(absStart), endTime: new Date(absEnd) }
        : parseTimeRangeParam(range, "1h");
      const { points, resolution } = await queryTelemetryAdaptive(
        ctx.orgId,
        source,
        metric,
        startTime,
        endTime,
      );
      const values = points
        .map((p) => p.value)
        .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
      if (values.length === 0) {
        return { source, metric, range, count: 0, note: "no data in this range" };
      }
      const round = (n: number) => Number(n.toFixed(4));
      const latest = points[points.length - 1];
      const summary: Record<string, unknown> = {
        source,
        metric,
        range,
        resolution,
        count: values.length,
        latest: latest?.value ?? null,
        latestAt: latest?.timestamp ?? null,
        min: round(Math.min(...values)),
        max: round(Math.max(...values)),
        avg: round(values.reduce((a, b) => a + b, 0) / values.length),
      };
      // Percentiles add useful context only over longer windows.
      const spanMs = endTime.getTime() - startTime.getTime();
      if (spanMs > 6 * 3600_000) {
        const days = Math.min(30, Math.max(1, Math.ceil(spanMs / 86_400_000)));
        const p = await getMetricPercentiles(ctx.orgId, source, metric, days);
        if (p) summary.percentiles = { p5: round(p.p5), p50: round(p.p50), p95: round(p.p95) };
      }
      // Downsampled shape (≤40 buckets) — the same summary the labeling flow
      // reads — so the model can see peaks/drops/gaps, not just endpoints.
      const shape = summarizeSeries(
        `${source}:${metric}`,
        points,
        startTime.getTime(),
        endTime.getTime(),
      );
      if (shape) summary.buckets = shape.buckets;
      summary.recentPoints = points.slice(-10).map((p) => ({ t: p.timestamp, v: p.value }));
      return summary;
    }
    case "get_fleet_status": {
      const [sources, counts] = await Promise.all([
        sourceQueries.findAllFiltered(ctx.orgId),
        alertQueries.getCountsByStatus(ctx.orgId),
      ]);
      const list = sources.slice(0, 200).map((s) => ({
        slug: s.slug,
        type: s.source_type,
        status: s.status,
      }));
      const online = list.filter((s) => s.status === "online").length;
      return {
        total: list.length,
        online,
        offline: list.length - online,
        alerts: counts,
        sources: list,
      };
    }
    case "list_alerts": {
      const status =
        args.status === "acknowledged" || args.status === "resolved"
          ? args.status
          : "open";
      const sourceId =
        typeof args.source === "string" && args.source.trim()
          ? args.source.trim()
          : undefined;
      const limit =
        typeof args.limit === "number" && args.limit > 0
          ? Math.min(200, Math.floor(args.limit))
          : 50;
      const alerts = await alertQueries.findAll(ctx.orgId, { status, sourceId, limit });
      return {
        status,
        count: alerts.length,
        alerts: alerts.map((al) => ({
          source: al.source_id,
          metric: al.metric,
          severity: al.severity,
          status: al.status,
          trigger: al.trigger_type,
          value: al.value,
          threshold: al.threshold,
          bound: al.bound,
          triggered_at: al.triggered_at,
        })),
      };
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}
