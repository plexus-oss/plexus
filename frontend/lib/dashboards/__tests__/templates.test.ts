import { describe, it, expect } from "vitest";
import {
  DASHBOARD_TEMPLATES,
  getTemplate,
  defaultTemplateForKind,
} from "../templates";
import { buildPanels } from "../quick-start-layout";

const SERVICE_METRICS = [
  "queue_depth",
  "request_count",
  "error_count",
  "request_latency_ms",
];

describe("dashboard templates", () => {
  it("has unique ids and every kind maps to a real template", () => {
    const ids = DASHBOARD_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of DASHBOARD_TEMPLATES) {
      expect(getTemplate(t.id)).toBe(t);
    }
  });

  it("defaultTemplateForKind falls back to the generic overview", () => {
    expect(defaultTemplateForKind("service").id).toBe("service-health");
    expect(defaultTemplateForKind("web-app").id).toBe("web-analytics");
    expect(defaultTemplateForKind(undefined).id).toBe("device-overview");
    expect(defaultTemplateForKind("no-such-kind").id).toBe("device-overview");
  });

  it("device-overview is byte-identical to the plain quick-start layout", () => {
    // Terminal proposals and the quick-start route share this invariant.
    const t = getTemplate("device-overview")!;
    expect(JSON.stringify(t.build(SERVICE_METRICS, "api-1"))).toBe(
      JSON.stringify(buildPanels(SERVICE_METRICS, "api-1")),
    );
  });

  it("service-health leads with latency, then errors", () => {
    const panels = getTemplate("service-health")!.build(SERVICE_METRICS, "api-1");
    const order = panels.map((p) => p.metrics[0]);
    const latencyIdx = order.findIndex((m) => m.includes("latency"));
    const errorIdx = order.findIndex((m) => m.includes("error"));
    const queueIdx = order.findIndex((m) => m.includes("queue"));
    expect(latencyIdx).toBeGreaterThanOrEqual(0);
    expect(latencyIdx).toBeLessThan(queueIdx);
    expect(errorIdx).toBeLessThan(queueIdx);
  });

  it("every template produces valid realtime panels", () => {
    for (const t of DASHBOARD_TEMPLATES) {
      const panels = t.build(["temperature", "uptime_seconds"], "dev-1");
      expect(panels.length).toBeGreaterThan(0);
      for (const p of panels) {
        expect(p.dataSource).toEqual({ type: "realtime" });
        expect(p.metrics.every((m) => m.startsWith("dev-1:"))).toBe(true);
      }
    }
  });
});
