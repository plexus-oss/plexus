/**
 * Mock data generators for each panel type
 *
 * When a panel has no metrics selected and no data source configured,
 * these generators provide realistic sample data so the visualization
 * is immediately useful. Panels show a "Sample data" indicator.
 */

import type { TelemetryData } from "@/components/dashboard/telemetry-provider";

// Helper: generate timestamps going back from now
function timestamps(count: number, intervalMs: number): string[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) =>
    new Date(now - (count - 1 - i) * intervalMs).toISOString(),
  );
}

// Helper: generate a noisy sine wave
function sine(
  count: number,
  amplitude: number,
  offset: number,
  frequency: number,
): number[] {
  return Array.from({ length: count }, (_, i) => {
    const noise = (Math.random() - 0.5) * amplitude * 0.15;
    return (
      offset +
      amplitude * Math.sin((i / count) * Math.PI * 2 * frequency) +
      noise
    );
  });
}

// Helper: generate a random walk
function randomWalk(count: number, start: number, step: number): number[] {
  const values: number[] = [start];
  for (let i = 1; i < count; i++) {
    values.push(values[i - 1] + (Math.random() - 0.5) * step);
  }
  return values;
}

/**
 * Generate mock TelemetryData for a given panel type.
 * Returns null if the panel type doesn't support mock data.
 */
export function generateMockData(panelType: string): TelemetryData | null {
  switch (panelType) {
    case "line":
    case "area": {
      const ts = timestamps(60, 15_000); // 60 points, 15s intervals = 15 min
      const temp = sine(60, 8, 22, 2);
      const humidity = sine(60, 15, 55, 1.5);
      return {
        "demo:temperature": ts.map((t, i) => ({
          timestamp: t,
          value: +temp[i].toFixed(1),
        })),
        "demo:humidity": ts.map((t, i) => ({
          timestamp: t,
          value: +humidity[i].toFixed(1),
        })),
      };
    }

    case "bar": {
      const ts = timestamps(8, 3_600_000); // 8 points, 1h intervals
      const values = [42, 67, 35, 89, 52, 74, 28, 61];
      return {
        "demo:requests": ts.map((t, i) => ({ timestamp: t, value: values[i] })),
      };
    }

    case "scatter": {
      const ts = timestamps(50, 60_000);
      const x = Array.from(
        { length: 50 },
        () => +(Math.random() * 100).toFixed(1),
      );
      const y = x.map(
        (v) => +(v * 0.7 + (Math.random() - 0.5) * 30 + 10).toFixed(1),
      );
      return {
        "demo:sensor_a": ts.map((t, i) => ({ timestamp: t, value: x[i] })),
        "demo:sensor_b": ts.map((t, i) => ({ timestamp: t, value: y[i] })),
      };
    }

    case "stat": {
      const ts = timestamps(20, 5_000);
      const walk = randomWalk(20, 72.5, 1.5);
      return {
        "demo:cpu_usage": ts.map((t, i) => ({
          timestamp: t,
          value: +walk[i].toFixed(1),
        })),
      };
    }

    case "gantt": {
      // Multiple metrics with on/off patterns create distinct task bars
      const now = Date.now();
      const hour = 3_600_000;
      const taskMetrics: Record<
        string,
        Array<{ timestamp: string; value: number }>
      > = {};

      // Each "metric" represents a task type with active (1) and inactive (0) periods
      const tasks = [
        { name: "demo:calibration", start: -5, end: -4 },
        { name: "demo:data_collection", start: -4, end: -2 },
        { name: "demo:processing", start: -2.5, end: -0.5 },
        { name: "demo:downlink", start: -1, end: 0.5 },
        { name: "demo:analysis", start: 0, end: 2 },
      ];

      for (const task of tasks) {
        const points: Array<{ timestamp: string; value: number }> = [];
        // Create points: 0 before start, 1 during, 0 after end
        points.push({
          timestamp: new Date(now + (task.start - 0.1) * hour).toISOString(),
          value: 0,
        });
        points.push({
          timestamp: new Date(now + task.start * hour).toISOString(),
          value: 1,
        });
        points.push({
          timestamp: new Date(now + task.end * hour).toISOString(),
          value: 1,
        });
        points.push({
          timestamp: new Date(now + (task.end + 0.1) * hour).toISOString(),
          value: 0,
        });
        taskMetrics[task.name] = points;
      }

      return taskMetrics;
    }

    case "list": {
      const ts = timestamps(6, 60_000);
      const codes = [200, 201, 200, 404, 200, 500];
      return {
        "demo:status_code": ts.map((t, i) => ({
          timestamp: t,
          value: codes[i],
        })),
      };
    }

    case "datagrid": {
      const ts = timestamps(10, 60_000);
      return {
        "demo:temperature": ts.map((t) => ({
          timestamp: t,
          value: +(20 + Math.random() * 10).toFixed(1),
        })),
        "demo:humidity": ts.map((t) => ({
          timestamp: t,
          value: +(40 + Math.random() * 30).toFixed(1),
        })),
        "demo:pressure": ts.map((t) => ({
          timestamp: t,
          value: +(1010 + Math.random() * 10).toFixed(1),
        })),
      };
    }

    // Panels that don't use TelemetryData or need real connections
    case "video":
    case "alerts":
    case "earth":
    case "satellite-info":
    case "model3d":
    case "dashboard":
      return null;

    default:
      return null;
  }
}

/**
 * Get mock metric names for a panel type.
 * Used to populate panel.metrics when adding with mock data.
 */
export function getMockMetrics(panelType: string): string[] {
  const data = generateMockData(panelType);
  if (!data) return [];
  return Object.keys(data);
}
