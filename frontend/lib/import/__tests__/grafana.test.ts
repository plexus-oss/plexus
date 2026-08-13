/**
 * Grafana converter tests.
 *
 * Fixture provenance: REAL dashboards fetched 2026-08-08 from the SatNOGS
 * network's public Grafana (https://dashboard.satnogs.org, anonymous API):
 *   - satnogs-aepex.json      /api/dashboards/uid/bflu6sloxxslcd (schemaVersion 41)
 *   - satnogs-amicalsat.json  /api/dashboards/uid/lhZUl7DGz      (schemaVersion 41)
 *   - satnogs-amsat-fox.json  /api/dashboards/uid/rHKE668ik      (schemaVersion 26,
 *     legacy graph/singlestat era)
 *
 * Three invariants:
 *   1. Real SatNOGS dashboards convert with zero throws and every panel
 *      accounted for (mapped or skipped-with-reason).
 *   2. Hostile input never throws — the converter is total.
 *   3. The binding path produces a config that passes the house dashboard
 *      validation schema.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  convertGrafanaDashboard,
  applyBindings,
  buildDashboardConfig,
  MAX_IMPORT_PANELS,
  type GrafanaConversion,
} from "@/lib/import/grafana";
import { UpdateDashboardSchema } from "@/lib/validation/api-schemas";
import { PANEL_TYPES } from "@/lib/panels/registry";

const FIXTURES = path.join(__dirname, "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

/** Shared invariants every conversion must satisfy. */
function expectAccountedFor(conversion: GrafanaConversion) {
  const { report, panels } = conversion;
  expect(report.mapped + report.skipped).toBe(report.totalPanels);
  expect(report.panels).toHaveLength(report.totalPanels);
  for (const entry of report.panels) {
    if (entry.outcome === "skipped") {
      expect(entry.reason, `skipped panel "${entry.title}" needs a reason`).toBeTruthy();
    } else {
      expect(entry.plexusType).toBeTruthy();
      expect(entry.panelId).toBeTruthy();
    }
  }
  // Every mapped entry points at a real produced panel and vice versa.
  const mappedIds = report.panels
    .filter((e) => e.outcome === "mapped")
    .map((e) => e.panelId);
  expect(new Set(mappedIds).size).toBe(mappedIds.length);
  expect(panels.map((p) => p.id).sort()).toEqual([...mappedIds].sort());
  // Layout stays inside the 24-column Plexus grid.
  for (const p of panels) {
    expect(PANEL_TYPES).toContain(p.type);
    expect(p.layout.x).toBeGreaterThanOrEqual(0);
    expect(p.layout.w).toBeGreaterThanOrEqual(1);
    expect(p.layout.x + p.layout.w).toBeLessThanOrEqual(24);
    expect(p.layout.h).toBeGreaterThanOrEqual(2);
  }
}

function typeCounts(conversion: GrafanaConversion): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of conversion.panels) out[p.type] = (out[p.type] ?? 0) + 1;
  return out;
}

// =============================================================================
// 1. Real SatNOGS fixtures
// =============================================================================

describe("SatNOGS fixtures", () => {
  it("converts AEPEX (schemaVersion 41: rows/text/timeseries/stat/gauge/bargauge)", () => {
    const conversion = convertGrafanaDashboard(loadFixture("satnogs-aepex.json"));
    expectAccountedFor(conversion);

    expect(conversion.title).toBe("AEPEX");
    expect(conversion.report.schemaVersion).toBe(41);
    // 69 panels: 10 titled rows + 2 text + 33 timeseries + 16 stat + 7 gauge + 1 bargauge
    expect(conversion.report.totalPanels).toBe(69);
    // Rows and text panels are skipped (Plexus has no text panel).
    expect(conversion.report.mapped).toBe(57);
    expect(conversion.report.skipped).toBe(12);

    const counts = typeCounts(conversion);
    // 33 line-drawStyle timeseries → line charts
    expect(counts.line).toBe(33);
    // 16 stat + 7 gauge + 1 bargauge → 24 stat tiles
    expect(counts.stat).toBe(24);
    // No text panels are produced anymore.
    expect(counts.text).toBeUndefined();

    // Gauges carry their lossy-mapping note.
    const gauge = conversion.report.panels.find((e) => e.grafanaType === "gauge");
    expect(gauge?.outcome).toBe("mapped");
    expect(gauge?.plexusType).toBe("stat");
    expect(gauge?.notes.join(" ")).toContain("gauge imported as a stat tile");

    // InfluxQL extraction: builder fields and raw queries both resolve.
    expect(conversion.report.metrics).toContain("sw_ana_bus_v"); // structured select field
    expect(conversion.report.metrics).toContain("pid"); // rawQuery SELECT last("pid")
    // The /^$suid$/ variable measurement must NOT leak into metric names.
    for (const m of conversion.report.metrics) {
      expect(m).not.toContain("$");
      expect(m).not.toContain("/");
    }

    // Bus Voltage gauge: unit volt → V, decimals kept, thresholds noted.
    const busVoltage = conversion.report.panels.find(
      (e) => e.title === "Bus Voltage",
    );
    expect(busVoltage?.outcome).toBe("mapped");
    const busPanel = conversion.panels.find((p) => p.id === busVoltage?.panelId);
    expect(busPanel?.config.unit).toBe("V");
    expect(busPanel?.config.decimals).toBe(2);
    expect(busVoltage?.notes.join(" ")).toContain("thresholds");
  });

  it("converts AmicalSat (timeseries/stat/table + unknown clock plugin)", () => {
    const conversion = convertGrafanaDashboard(
      loadFixture("satnogs-amicalsat.json"),
    );
    expectAccountedFor(conversion);

    expect(conversion.title).toBe("AmicalSat");
    // 47 panels: 1 text + 18 timeseries + 1 clock plugin + 25 stat + 2 table
    expect(conversion.report.totalPanels).toBe(47);

    const counts = typeCounts(conversion);
    expect(counts.stat).toBe(25);
    expect(counts.datagrid).toBe(2); // Grafana tables → data grids

    // Unknown plugin type with an extractable query degrades to a line chart
    // with an explicit note — data survives, nothing silently vanishes.
    const clock = conversion.report.panels.find(
      (e) => e.grafanaType === "grafana-clock-panel",
    );
    expect(clock?.outcome).toBe("mapped");
    expect(clock?.plexusType).toBe("line");
    expect(clock?.notes.join(" ")).toContain("unknown panel type");
  });

  it("converts AMSAT FOX (schemaVersion 26: legacy graph/singlestat)", () => {
    const conversion = convertGrafanaDashboard(
      loadFixture("satnogs-amsat-fox.json"),
    );
    expectAccountedFor(conversion);

    expect(conversion.report.schemaVersion).toBe(26);
    // 27 panels: 7 graph + 20 singlestat — all mapped
    expect(conversion.report.totalPanels).toBe(27);
    expect(conversion.report.mapped).toBe(27);

    const counts = typeCounts(conversion);
    expect(counts.line).toBe(7); // legacy graphs (no bars/points, fill<5)
    expect(counts.stat).toBe(20); // singlestat → stat tiles

    // Legacy InfluxQL builder targets still yield metric identities.
    expect(conversion.report.metrics).toContain("id");
  });

  it("maps Grafana grid coords onto the Plexus 24-col/40px grid", () => {
    const conversion = convertGrafanaDashboard(loadFixture("satnogs-aepex.json"));
    // "Ground Stations Leaderboard By Observed Frames": gridPos {h:9,w:12,x:4,y:1}
    const entry = conversion.report.panels.find((e) =>
      e.title.startsWith("Ground Stations Leaderboard"),
    );
    const panel = conversion.panels.find((p) => p.id === entry?.panelId);
    expect(panel?.layout.x).toBe(4); // 24-col x carries 1:1
    expect(panel?.layout.w).toBe(12); // 24-col w carries 1:1
    expect(panel?.layout.h).toBe(Math.round(9 * 0.75)); // 30px → 40px rows
  });
});

// =============================================================================
// 2. Hostile input — the converter is total
// =============================================================================

describe("hostile input", () => {
  const garbage: Array<[string, unknown]> = [
    ["empty object", {}],
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["string", "not a dashboard"],
    ["array", [1, 2, 3]],
    ["panels is a string", { panels: "nope" }],
    ["panels is an object", { panels: { a: 1 } }],
    ["panel entries are junk", { panels: [null, 7, "x", [], true] }],
    ["panel with no fields at all", { panels: [{}] }],
    ["panel with junk gridPos", { panels: [{ type: "stat", gridPos: "left" }] }],
    [
      "panel with NaN/negative/string gridPos values",
      {
        panels: [
          { type: "timeseries", gridPos: { x: -5, y: NaN, w: "wide", h: 1e9 } },
        ],
      },
    ],
    ["panel with targets garbage", { panels: [{ type: "timeseries", targets: "nope" }] }],
    ["panel with null targets entries", { panels: [{ type: "stat", targets: [null, 3, {}] }] }],
    ["fieldConfig is a number", { panels: [{ type: "stat", fieldConfig: 17 }] }],
    ["templating is junk", { panels: [], templating: "vars" }],
    ["time is junk", { panels: [], time: 9 }],
    ["wrapped garbage", { dashboard: { panels: [{ type: "??" }] } }],
  ];

  it.each(garbage)("never throws on %s", (_label, input) => {
    const conversion = convertGrafanaDashboard(input);
    expectAccountedFor(conversion);
    // And the binding path stays total too.
    const { panels } = applyBindings(conversion, {});
    expect(Array.isArray(panels)).toBe(true);
  });

  it("accounts for every panel of a 10k-panel dashboard without throwing", () => {
    const panels = Array.from({ length: 10_000 }, (_, i) => ({
      id: i,
      type: i % 3 === 0 ? "timeseries" : i % 3 === 1 ? "stat" : "who-knows",
      title: `p${i}`,
      gridPos: { x: (i * 6) % 24, y: Math.floor(i / 4) * 4, w: 6, h: 4 },
    }));
    const conversion = convertGrafanaDashboard({ title: "big", panels });
    expectAccountedFor(conversion);
    expect(conversion.report.totalPanels).toBe(10_000);
    // Only the first MAX_IMPORT_PANELS become real panels; everything after
    // is skipped with the cap reason — accounted for, not silently dropped.
    expect(conversion.panels.length).toBe(MAX_IMPORT_PANELS);
    expect(conversion.report.mapped).toBe(MAX_IMPORT_PANELS);
    const capSkips = conversion.report.panels.filter((e) =>
      e.reason?.includes("import cap"),
    );
    const unsupportedSkips = conversion.report.panels.filter((e) =>
      e.reason?.includes("unsupported panel type"),
    );
    expect(
      conversion.report.mapped + capSkips.length + unsupportedSkips.length,
    ).toBe(10_000);
  });

  it("walks nested and collapsed rows, capping pathological depth", () => {
    // Grafana stores collapsed-row children inside row.panels.
    const collapsed = {
      panels: [
        {
          type: "row",
          title: "EPS",
          collapsed: true,
          gridPos: { x: 0, y: 0, w: 24, h: 1 },
          panels: [
            {
              type: "timeseries",
              title: "Battery",
              gridPos: { x: 0, y: 1, w: 12, h: 8 },
              targets: [{ expr: "battery_voltage{sat='a'}" }],
            },
          ],
        },
      ],
    };
    const conversion = convertGrafanaDashboard(collapsed);
    expectAccountedFor(conversion);
    expect(conversion.report.totalPanels).toBe(2); // row + nested child
    const child = conversion.report.panels.find((e) => e.title === "Battery");
    expect(child?.outcome).toBe("mapped");
    expect(child?.metrics).toEqual(["battery_voltage"]);

    // Pathological self-nesting terminates with a warning.
    const deep: Record<string, unknown> = {
      type: "row",
      title: "d",
      gridPos: { x: 0, y: 0, w: 24, h: 1 },
    };
    let cursor = deep;
    for (let i = 0; i < 50; i++) {
      const next: Record<string, unknown> = {
        type: "row",
        title: `d${i}`,
        gridPos: { x: 0, y: 0, w: 24, h: 1 },
      };
      cursor.panels = [next];
      cursor = next;
    }
    const deepConversion = convertGrafanaDashboard({ panels: [deep] });
    expectAccountedFor(deepConversion);
    expect(
      deepConversion.report.warnings.some((w) => w.includes("nesting")),
    ).toBe(true);
  });

  it("skips text panels (Plexus has no text panel)", () => {
    const conversion = convertGrafanaDashboard({
      panels: [
        { type: "text", title: "empty", gridPos: { x: 0, y: 0, w: 6, h: 4 } },
        {
          type: "text",
          title: "notes",
          options: { content: "# Ops notes" },
          gridPos: { x: 6, y: 0, w: 6, h: 4 },
        },
      ],
    });
    expectAccountedFor(conversion);
    const [empty, notes] = conversion.report.panels;
    expect(empty.outcome).toBe("skipped");
    expect(empty.reason).toContain("unsupported panel type");
    expect(notes.outcome).toBe("skipped");
    expect(notes.reason).toContain("unsupported panel type");
    expect(conversion.panels).toHaveLength(0);
  });

  it("extracts metric identities across query languages", () => {
    const conversion = convertGrafanaDashboard({
      panels: [
        {
          type: "timeseries",
          title: "prom",
          gridPos: { x: 0, y: 0, w: 6, h: 4 },
          targets: [
            { expr: 'sum(rate(node_cpu_seconds_total{mode="idle"}[5m])) by (cpu)' },
          ],
        },
        {
          type: "timeseries",
          title: "sql",
          gridPos: { x: 6, y: 0, w: 6, h: 4 },
          targets: [
            {
              rawSql:
                "SELECT $__timeGroup(ts, '1m'), avg(coolant_temp) AS coolant_temp FROM telemetry WHERE $__timeFilter(ts)",
            },
          ],
        },
        {
          type: "timeseries",
          title: "graphite",
          gridPos: { x: 12, y: 0, w: 6, h: 4 },
          targets: [
            { target: "aliasByNode(stations.gs1.wheel2.rpm, 2)" },
          ],
        },
        {
          type: "timeseries",
          title: "influx",
          gridPos: { x: 18, y: 0, w: 6, h: 4 },
          targets: [
            {
              measurement: "downlink",
              select: [[{ type: "field", params: ["snr"] }]],
            },
          ],
        },
      ],
    });
    expectAccountedFor(conversion);
    expect(conversion.report.metrics).toContain("node_cpu_seconds_total");
    expect(conversion.report.metrics).toContain("coolant_temp");
    expect(conversion.report.metrics).toContain("stations.gs1.wheel2.rpm");
    expect(conversion.report.metrics).toContain("downlink.snr"); // measurement.field
  });
});

// =============================================================================
// 3. Binding path → house validation schema
// =============================================================================

describe("binding path", () => {
  it("binds extracted names to source:metric pairs and passes house validation", () => {
    const conversion = convertGrafanaDashboard(loadFixture("satnogs-aepex.json"));
    const bindings = Object.fromEntries(
      conversion.report.metrics.map((m, i) => [
        m,
        { sourceRef: "aepex-sat", metric: `telemetry_${i}` },
      ]),
    );
    const { panels, unbound } = applyBindings(conversion, bindings);
    expect(unbound).toEqual([]);

    // Every data panel that had extracted metrics is now bound.
    const boundPanels = panels.filter((p) => p.metrics.length > 0);
    expect(boundPanels.length).toBeGreaterThan(0);
    for (const p of boundPanels) {
      for (const key of p.metrics) {
        expect(key).toMatch(/^aepex-sat:telemetry_\d+$/);
      }
      expect(p.sources).toEqual(["aepex-sat"]);
      expect(p.dataSource).toEqual({ type: "realtime" });
    }

    // The final config passes the same schema PUT /api/dashboards/[id] enforces.
    const config = buildDashboardConfig(conversion, panels);
    const parsed = UpdateDashboardSchema.safeParse({ config });
    expect(parsed.success).toBe(true);
    expect(config.timeRange.type).toBe("relative");
  });

  it("leaves unbound metrics off the panel (placeholder state) and reports them", () => {
    const conversion = convertGrafanaDashboard({
      panels: [
        {
          type: "timeseries",
          title: "two series",
          gridPos: { x: 0, y: 0, w: 12, h: 8 },
          targets: [{ expr: "bus_voltage" }, { expr: "bus_current" }],
        },
      ],
    });
    const { panels, unbound } = applyBindings(conversion, {
      bus_voltage: { sourceRef: "sat-1", metric: "bus_v" },
    });
    expect(unbound).toEqual(["bus_current"]);
    expect(panels[0].metrics).toEqual(["sat-1:bus_v"]);

    // Nothing bound at all → panel imports as an empty placeholder.
    const none = applyBindings(conversion, {});
    expect(none.unbound).toEqual(["bus_voltage", "bus_current"]);
    expect(none.panels[0].metrics).toEqual([]);
  });
});
