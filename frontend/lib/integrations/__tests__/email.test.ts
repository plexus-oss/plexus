import { describe, it, expect } from "vitest";
import {
  buildAlertEmailHtml,
  buildAlertEmailText,
  buildSubject,
} from "../email";

const triggered = {
  alertId: "a1",
  sourceName: "Engine 01",
  sourceSlug: "engine-01",
  metric: "coolant_temp",
  value: 112.4,
  threshold: 90,
  bound: "max",
  severity: "critical" as const,
  status: "open" as const,
  triggerType: "alert_rule" as const,
  contextSnapshot: {
    z_score: 4.2,
    window: "5m",
    attachments: "system-key-hidden",
    nested: { skipped: true },
  },
  recommendedActions: ["Check the coolant loop", "Reduce load"],
  message: "coolant_temp exceeded threshold",
  triggeredAt: "2026-07-31T14:02:11.000Z",
};

describe("buildAlertEmailHtml", () => {
  it("renders the panel's hero block: value, bound label, delta, severity accent", () => {
    const { html, preheader } = buildAlertEmailHtml("alert.triggered", triggered);
    expect(html).toContain("112.40");
    expect(html).toContain("Max threshold");
    // (112.4 - 90) / 90 = 24.9%
    expect(html).toContain("↑ 24.9%");
    expect(html).toContain("over 90");
    expect(html).toContain("#ef4444"); // critical red-500, panel-canonical
    expect(preheader).toContain("coolant_temp 112.40");
  });

  it("renders context snapshot rows, skipping system keys and objects", () => {
    const { html } = buildAlertEmailHtml("alert.triggered", triggered);
    expect(html).toContain("Z Score");
    expect(html).toContain("4.2");
    expect(html).not.toContain("system-key-hidden");
    expect(html).not.toContain("Nested");
  });

  it("renders recommended actions and deep links", () => {
    const { html } = buildAlertEmailHtml("alert.triggered", triggered);
    expect(html).toContain("Check the coolant loop");
    expect(html).toContain("/alerts?selected=a1");
    expect(html).toContain("/devices/engine-01");
  });

  it("renders resolution stats and notes on resolved emails only", () => {
    const resolved = {
      ...triggered,
      status: "resolved" as const,
      alertStats: { duration_seconds: 272, peak_value: 118.2, data_point_count: 54 },
      resolutionNotes: "Replaced the coolant pump.",
    };
    const { html } = buildAlertEmailHtml("alert.resolved", resolved);
    expect(html).toContain("4m 32s");
    expect(html).toContain("118.20");
    expect(html).toContain("Replaced the coolant pump.");
    expect(html).not.toContain("Recommended Actions");
    expect(html).toContain("#10b981"); // emerald recovery accent

    const open = buildAlertEmailHtml("alert.triggered", triggered);
    expect(open.html).not.toContain("Duration");
  });

  it("escapes HTML in payload-controlled strings", () => {
    const { html } = buildAlertEmailHtml("alert.triggered", {
      ...triggered,
      metric: 'temp<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("temp&lt;script&gt;");
  });

  it("uses the branded shell", () => {
    const { html } = buildAlertEmailHtml("alert.triggered", triggered);
    expect(html).toContain("/black.png"); // logo
    expect(html).toContain("Plexus — telemetry for hardware fleets"); // footer
  });
});

describe("buildAlertEmailText", () => {
  it("mirrors the HTML content in plain text", () => {
    const text = buildAlertEmailText("alert.triggered", triggered);
    expect(text).toContain("Alert Triggered — coolant_temp");
    expect(text).toContain("critical · open · Engine 01");
    expect(text).toContain("Value: 112.40 (max threshold: 90, ↑ 24.9% over)");
    expect(text).toContain("1. Check the coolant loop");
    expect(text).toContain("/alerts?selected=a1");
  });
});

describe("buildSubject", () => {
  it("leads with severity for triggered alerts", () => {
    expect(buildSubject("alert.triggered", triggered)).toBe(
      "[Plexus] Critical alert: Engine 01 — coolant_temp",
    );
  });

  it("labels resolved and metric-only alerts", () => {
    expect(buildSubject("alert.resolved", triggered)).toBe(
      "[Plexus] Resolved: Engine 01 — coolant_temp",
    );
    expect(
      buildSubject("alert.triggered", { metric: "coolant_temp", severity: "warning" }),
    ).toBe("[Plexus] Warning alert: coolant_temp");
  });
});
