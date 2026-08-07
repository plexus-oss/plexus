/**
 * Email Alert Client
 *
 * Sends alert notifications via email using Resend. Bodies render through the
 * shared branded shell (lib/email/layout.ts) and mirror the alert detail
 * panel (components/alerts/alert-story-panel.tsx): same severity palette,
 * mono metric header, hero value-vs-threshold block with delta line, event
 * data rows from the context snapshot, and recommended actions.
 */

import "server-only";

import { renderEmail, emailButton, appUrl } from "@/lib/email/layout";
import type { EmailIntegration, WebhookEventType } from "@/lib/db/types";

const RESEND_API_URL = "https://api.resend.com/emails";
const DELIVERY_TIMEOUT_MS = 30_000;

export interface EmailDeliveryResult {
  success: boolean;
  responseStatus?: number;
  responseTimeMs?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Palette + formatting
// ---------------------------------------------------------------------------

// Canonical severity hexes from the alert panel (red-500 / amber-500 /
// blue-500); emerald-500 for recovery, zinc-500 neutral.
const SEVERITY_HEX: Record<string, string> = {
  critical: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
};
const RECOVERY_HEX = "#10b981";
const NEUTRAL_HEX = "#71717a";
const MUTED = "#71717a"; // zinc-500
const INK = "#18181b"; // zinc-900
const HAIRLINE = "#e4e4e7"; // zinc-200
const TRACK = "#f4f4f5"; // zinc-100
const MONO = "'SF Mono', Menlo, Consolas, monospace";

function getAccentColor(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): string {
  switch (eventType) {
    case "alert.triggered":
      return SEVERITY_HEX[String(data.severity)] ?? SEVERITY_HEX.critical;
    case "threshold.critical":
      return SEVERITY_HEX.critical;
    case "threshold.warning":
    case "device.offline":
    case "alert.acknowledged": // matches the panel's amber acknowledged status
      return SEVERITY_HEX.warning;
    case "alert.resolved":
    case "device.online":
      return RECOVERY_HEX;
    default:
      return NEUTRAL_HEX;
  }
}

/**
 * Map event types to human-readable labels
 */
function getEventLabel(eventType: WebhookEventType): string {
  switch (eventType) {
    case "alert.triggered":
      return "Alert Triggered";
    case "alert.resolved":
      return "Alert Resolved";
    case "alert.acknowledged":
      return "Alert Acknowledged";
    case "device.online":
      return "Device Online";
    case "device.offline":
      return "Device Offline";
    case "threshold.warning":
      return "Threshold Warning";
    case "threshold.critical":
      return "Threshold Critical";
    default:
      return "Event";
  }
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatValue(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 19)} UTC`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function titleCase(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Payload extraction (same parsing rules as the alert panel)
// ---------------------------------------------------------------------------

const CONTEXT_SYSTEM_KEYS = new Set(["attachments", "_visualization"]);
const MAX_CONTEXT_ROWS = 12;

function contextEntries(
  data: Record<string, unknown>,
): { label: string; value: string }[] {
  const ctx = data.contextSnapshot;
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return [];
  return Object.entries(ctx as Record<string, unknown>)
    .filter(([k, v]) => !CONTEXT_SYSTEM_KEYS.has(k) && typeof v !== "object")
    .slice(0, MAX_CONTEXT_ROWS)
    .map(([k, v]) => ({ label: titleCase(k), value: String(v) }));
}

function recommendedActions(data: Record<string, unknown>): string[] {
  const raw = data.recommendedActions;
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === "object") {
    const actions = (raw as Record<string, unknown>).actions;
    if (Array.isArray(actions)) return actions.map(String);
  }
  return [];
}

interface StatsView {
  duration?: string;
  peak?: string;
  points?: string;
}

function alertStats(data: Record<string, unknown>): StatsView {
  const raw = data.alertStats;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const stats = raw as Record<string, unknown>;
  const view: StatsView = {};
  if (typeof stats.duration_seconds === "number")
    view.duration = formatDuration(stats.duration_seconds);
  if (typeof stats.peak_value === "number")
    view.peak = formatValue(stats.peak_value);
  if (typeof stats.data_point_count === "number")
    view.points = String(stats.data_point_count);
  return view;
}

interface DeltaView {
  arrow: string;
  relation: string;
  deltaPct: number;
  barPct: number;
  thresholdLabel: string;
}

/** Mirrors the hero-block math in alert-story-panel.tsx. */
function deltaView(data: Record<string, unknown>): DeltaView | null {
  const v = Number(data.value);
  const t = data.threshold != null ? Number(data.threshold) : null;
  if (!Number.isFinite(v) || t == null || !Number.isFinite(t)) return null;
  const bound = data.bound as string | undefined;
  const deltaPct = ((v - t) / Math.max(Math.abs(t), 1e-9)) * 100;
  const overMax = bound === "max" && v > t;
  const underMin = bound === "min" && v < t;
  return {
    arrow: overMax ? "↑" : underMin ? "↓" : "",
    relation: overMax ? "over" : underMin ? "under" : "of",
    deltaPct,
    barPct: Math.min((Math.abs(v - t) / Math.max(Math.abs(t), 1)) * 100, 100),
    thresholdLabel:
      bound === "max"
        ? "Max threshold"
        : bound === "min"
          ? "Min threshold"
          : "Threshold",
  };
}

// ---------------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------------

function sectionLabel(text: string, color: string = MUTED): string {
  return `<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${color};margin-bottom:6px;">${text}</div>`;
}

/** Exported for tests; not part of the module's public surface otherwise. */
export function buildAlertEmailHtml(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): { html: string; preheader: string } {
  const accent = getAccentColor(eventType, data);
  const label = getEventLabel(eventType);
  const url = appUrl();
  const alertUrl = data.alertId
    ? `${url}/alerts?selected=${data.alertId}`
    : `${url}/alerts`;

  const metric = data.metric ? String(data.metric) : undefined;
  const deviceName = (data.sourceName as string) || (data.sourceSlug as string);
  const title =
    metric ||
    (data.message as string) ||
    (data.summary as string) ||
    deviceName ||
    label;

  // Meta line: severity · status · slug · time — the panel's header line.
  // Severity always wears its own color (as in the panel), independent of
  // the event accent, so "critical" doesn't turn emerald on resolved emails.
  const metaParts: string[] = [];
  if (data.severity)
    metaParts.push(
      `<span style="color:${SEVERITY_HEX[String(data.severity)] ?? NEUTRAL_HEX};">${escapeHtml(data.severity)}</span>`,
    );
  if (data.status) metaParts.push(escapeHtml(data.status));
  if (data.sourceSlug)
    metaParts.push(
      `<span style="font-family:${MONO};font-size:11px;">${escapeHtml(data.sourceSlug)}</span>`,
    );
  else if (deviceName) metaParts.push(escapeHtml(deviceName));
  const metaTime =
    (eventType === "alert.resolved" && data.resolvedAt) ||
    (eventType === "alert.acknowledged" && data.acknowledgedAt) ||
    data.triggeredAt;
  if (metaTime) metaParts.push(escapeHtml(formatUtc(String(metaTime))));

  // Hero: value vs threshold with delta line + hairline bar.
  let heroHtml = "";
  if (data.value !== undefined) {
    const delta = deltaView(data);
    const thresholdLabel = delta?.thresholdLabel ?? "Threshold";
    const deltaLine =
      delta && delta.arrow
        ? `<div style="margin-top:10px;font-size:12px;">
            <span style="color:${accent};font-weight:600;">${delta.arrow} ${Math.abs(delta.deltaPct).toFixed(1)}%</span>
            <span style="color:${MUTED};"> ${delta.relation} ${escapeHtml(data.threshold)}</span>
          </div>
          <div style="margin-top:8px;height:2px;background:${TRACK};font-size:0;line-height:0;">
            <div style="height:2px;width:${delta.barPct.toFixed(0)}%;background:${accent};"></div>
          </div>`
        : "";
    heroHtml = `
      <div style="margin-top:18px;padding:16px 0;border-top:1px solid ${HAIRLINE};border-bottom:1px solid ${HAIRLINE};">
        <table width="100%" style="border-collapse:collapse;">
          <tr>
            <td style="vertical-align:baseline;">
              ${sectionLabel("Value")}
              <div style="font-family:${MONO};font-size:28px;font-weight:500;color:${INK};line-height:1;">${escapeHtml(formatValue(data.value))}</div>
            </td>
            <td align="right" style="vertical-align:baseline;">
              ${sectionLabel(escapeHtml(thresholdLabel))}
              <div style="font-family:${MONO};font-size:16px;color:${MUTED};line-height:1;">${data.threshold != null ? escapeHtml(data.threshold) : "—"}</div>
            </td>
          </tr>
        </table>
        ${deltaLine}
      </div>`;
  }

  // Event data rows from the context snapshot.
  const ctxRows = contextEntries(data);
  const ctxHtml =
    ctxRows.length > 0
      ? `<div style="margin-top:18px;">
          ${sectionLabel("Event Data")}
          <table width="100%" style="border-collapse:collapse;border-top:1px solid ${HAIRLINE};">
            ${ctxRows
              .map(
                (r) =>
                  `<tr>
                    <td style="padding:6px 0;border-bottom:1px solid ${HAIRLINE};font-size:12px;color:${MUTED};">${escapeHtml(r.label)}</td>
                    <td align="right" style="padding:6px 0;border-bottom:1px solid ${HAIRLINE};font-family:${MONO};font-size:12px;color:${INK};">${escapeHtml(r.value)}</td>
                  </tr>`,
              )
              .join("")}
          </table>
        </div>`
      : "";

  // Resolution stats (Duration · Peak · Points) + notes — resolved emails.
  const stats = eventType === "alert.resolved" ? alertStats(data) : {};
  const statCells = [
    stats.duration && { label: "Duration", value: stats.duration },
    stats.peak && { label: "Peak", value: stats.peak },
    stats.points && { label: "Points", value: stats.points },
  ].filter(Boolean) as { label: string; value: string }[];
  const statsHtml =
    statCells.length > 0
      ? `<table style="border-collapse:collapse;margin-top:18px;">
          <tr>
            ${statCells
              .map(
                (c, i) =>
                  `<td style="padding:0 18px 0 ${i === 0 ? "0" : "18px"};${i > 0 ? `border-left:1px solid ${HAIRLINE};` : ""}">
                    ${sectionLabel(escapeHtml(c.label))}
                    <div style="font-family:${MONO};font-size:14px;color:${INK};">${escapeHtml(c.value)}</div>
                  </td>`,
              )
              .join("")}
          </tr>
        </table>`
      : "";
  const notesHtml =
    eventType === "alert.resolved" && data.resolutionNotes
      ? `<div style="margin-top:18px;">
          ${sectionLabel("Resolution")}
          <div style="border-left:2px solid ${HAIRLINE};padding-left:12px;font-size:13px;color:#3f3f46;white-space:pre-line;">${escapeHtml(data.resolutionNotes)}</div>
        </div>`
      : "";

  // Recommended actions — triggered emails only, emerald like the panel.
  const actions =
    eventType === "alert.triggered" ? recommendedActions(data) : [];
  const actionsHtml =
    actions.length > 0
      ? `<div style="margin-top:18px;">
          ${sectionLabel("Recommended Actions")}
          <table style="border-collapse:collapse;">
            ${actions
              .map(
                (a, i) =>
                  `<tr>
                    <td style="padding:3px 10px 3px 0;vertical-align:top;font-size:12px;font-weight:600;color:${RECOVERY_HEX};">${i + 1}.</td>
                    <td style="padding:3px 0;font-size:13px;color:#3f3f46;">${escapeHtml(a)}</td>
                  </tr>`,
              )
              .join("")}
          </table>
        </div>`
      : "";

  const deviceLink = data.sourceSlug
    ? `<a href="${url}/devices/${escapeHtml(data.sourceSlug)}" style="margin-left:16px;font-size:14px;color:${INK};">View device →</a>`
    : "";

  const bodyHtml = `
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${accent};margin-bottom:8px;">${label}</div>
    <div style="font-family:${MONO};font-size:17px;font-weight:600;color:${INK};line-height:1.3;">${escapeHtml(title)}</div>
    ${metaParts.length > 0 ? `<div style="margin-top:5px;font-size:12px;color:${MUTED};">${metaParts.join(" &nbsp;·&nbsp; ")}</div>` : ""}
    ${heroHtml}
    ${ctxHtml}
    ${statsHtml}
    ${notesHtml}
    ${actionsHtml}
    <div style="margin-top:24px;">${emailButton(alertUrl, "View alert")}${deviceLink}</div>`;

  const delta = deltaView(data);
  const preheader =
    metric && data.value !== undefined
      ? `${metric} ${formatValue(data.value)}${
          delta && delta.arrow
            ? ` — ${delta.arrow} ${Math.abs(delta.deltaPct).toFixed(1)}% ${delta.relation} ${data.threshold}`
            : ""
        }`
      : (data.message as string) || label;

  return {
    html: renderEmail({ bodyHtml, preheader: escapeHtml(preheader) }),
    preheader,
  };
}

/**
 * Plain-text alternative — same content as the HTML part.
 * Exported for tests; not part of the module's public surface otherwise.
 */
export function buildAlertEmailText(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): string {
  const label = getEventLabel(eventType);
  const url = appUrl();
  const lines: string[] = [];

  const metric = data.metric ? String(data.metric) : undefined;
  lines.push(metric ? `${label} — ${metric}` : label);

  const metaTime =
    (eventType === "alert.resolved" && data.resolvedAt) ||
    (eventType === "alert.acknowledged" && data.acknowledgedAt) ||
    data.triggeredAt;
  const metaParts = [
    data.severity,
    data.status,
    data.sourceName || data.sourceSlug,
    metaTime ? formatUtc(String(metaTime)) : undefined,
  ].filter(Boolean);
  if (metaParts.length > 0) lines.push(metaParts.join(" · "));
  lines.push("");

  if (data.value !== undefined) {
    const delta = deltaView(data);
    let valueLine = `Value: ${formatValue(data.value)}`;
    if (data.threshold != null) {
      valueLine += ` (${(delta?.thresholdLabel ?? "threshold").toLowerCase()}: ${data.threshold}`;
      if (delta && delta.arrow)
        valueLine += `, ${delta.arrow} ${Math.abs(delta.deltaPct).toFixed(1)}% ${delta.relation}`;
      valueLine += ")";
    }
    lines.push(valueLine);
  }

  const ctxRows = contextEntries(data);
  if (ctxRows.length > 0) {
    lines.push("");
    for (const r of ctxRows) lines.push(`${r.label}: ${r.value}`);
  }

  if (eventType === "alert.resolved") {
    const stats = alertStats(data);
    const statParts = [
      stats.duration && `Duration: ${stats.duration}`,
      stats.peak && `Peak: ${stats.peak}`,
      stats.points && `Points: ${stats.points}`,
    ].filter(Boolean);
    if (statParts.length > 0) {
      lines.push("");
      lines.push(statParts.join(" · "));
    }
    if (data.resolutionNotes) {
      lines.push("");
      lines.push(`Resolution: ${data.resolutionNotes}`);
    }
  }

  if (eventType === "alert.triggered") {
    const actions = recommendedActions(data);
    if (actions.length > 0) {
      lines.push("");
      lines.push("Recommended actions:");
      actions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
    }
  }

  lines.push("");
  lines.push(
    `View alert: ${data.alertId ? `${url}/alerts?selected=${data.alertId}` : `${url}/alerts`}`,
  );
  if (data.sourceSlug) lines.push(`Device: ${url}/devices/${data.sourceSlug}`);

  return lines.join("\n");
}

/**
 * Build a plain-text subject line for the email.
 * Exported for tests; not part of the module's public surface otherwise.
 */
export function buildSubject(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): string {
  let label: string;
  switch (eventType) {
    case "alert.triggered": {
      const sev = String(data.severity || "");
      label = sev ? `${sev[0].toUpperCase()}${sev.slice(1)} alert` : "Alert";
      break;
    }
    case "alert.resolved":
      label = "Resolved";
      break;
    case "alert.acknowledged":
      label = "Acknowledged";
      break;
    default:
      label = getEventLabel(eventType);
  }
  const source = (data.sourceName as string) || (data.sourceSlug as string);
  const metric = data.metric as string;

  if (source && metric) return `[Plexus] ${label}: ${source} — ${metric}`;
  if (source) return `[Plexus] ${label}: ${source}`;
  if (metric) return `[Plexus] ${label}: ${metric}`;
  return `[Plexus] ${label}`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Send an email via Resend API
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<EmailDeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const fromAddress =
    process.env.RESEND_FROM_ADDRESS || "Plexus <alerts@plexus.company>";

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject,
        html,
        ...(text ? { text } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, responseStatus: response.status, responseTimeMs };
    }

    const body = await response.text().catch(() => "");
    return {
      success: false,
      responseStatus: response.status,
      responseTimeMs,
      error: `Resend API returned ${response.status}: ${body}`,
    };
  } catch (err) {
    const responseTimeMs = Date.now() - startTime;
    if (err instanceof Error && err.name === "AbortError") {
      return {
        success: false,
        responseTimeMs,
        error: `Email delivery timed out after ${DELIVERY_TIMEOUT_MS}ms`,
      };
    }
    return {
      success: false,
      responseTimeMs,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Send an event to a single email integration.
 * Iteration and durability (delivery records, retries) live in
 * lib/notifications/deliver.ts.
 */
export async function deliverToEmailIntegration(
  integration: EmailIntegration,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): Promise<EmailDeliveryResult> {
  const subject = buildSubject(eventType, data);
  const { html } = buildAlertEmailHtml(eventType, data);
  const text = buildAlertEmailText(eventType, data);
  return sendEmail(integration.email_address, subject, html, text);
}

/**
 * Send a test email to a specific integration
 */
export async function sendTestEmail(
  integration: EmailIntegration,
): Promise<EmailDeliveryResult> {
  const data = {
    alertId: `test-${Date.now()}`,
    sourceName: "Test Source",
    sourceSlug: "test-source",
    metric: "test_metric",
    value: 112.4,
    threshold: 90,
    bound: "max",
    severity: "critical",
    status: "open",
    triggerType: "limit_violation",
    contextSnapshot: { z_score: 4.2, window: "5m" },
    recommendedActions: [
      "This is a test alert from Plexus to verify your email integration.",
    ],
    message:
      "This is a test alert from Plexus to verify your email integration.",
    triggeredAt: new Date().toISOString(),
  };
  const subject = "[Plexus] Test Alert";
  const { html } = buildAlertEmailHtml("alert.triggered", data);
  const text = buildAlertEmailText("alert.triggered", data);

  return sendEmail(integration.email_address, subject, html, text);
}
