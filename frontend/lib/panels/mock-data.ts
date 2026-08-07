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

    case "heatmap": {
      // Dense data with a realistic pattern — API latency that clusters around 30-50ms
      // with occasional spikes to 100-200ms during peak hours
      const ts = timestamps(500, 12_000); // 500 points over ~100 minutes
      const values = Array.from({ length: 500 }, (_, i) => {
        const hour = (i / 500) * 100; // progress through the window
        const isPeak = hour > 30 && hour < 70;
        const base = isPeak ? 60 : 30;
        const spread = isPeak ? 80 : 25;
        // Bimodal: most values cluster low, some spike high
        const r = Math.random();
        if (r > 0.85 && isPeak) {
          return +(base + spread + Math.random() * spread).toFixed(1); // spike
        }
        return +(base + (Math.random() - 0.3) * spread).toFixed(1);
      });
      return {
        "demo:latency_ms": ts.map((t, i) => ({
          timestamp: t,
          value: Math.max(1, values[i]),
        })),
      };
    }

    case "radar": {
      const ts = timestamps(30, 1_000);
      // Simulate radar sweep with bearing/range
      const bearings = Array.from({ length: 30 }, (_, i) => i * 12); // 0-348 degrees
      const ranges = Array.from(
        { length: 30 },
        () => +(Math.random() * 80 + 20).toFixed(0),
      );
      return {
        "demo:bearing": ts.map((t, i) => ({
          timestamp: t,
          value: bearings[i],
        })),
        "demo:range": ts.map((t, i) => ({ timestamp: t, value: ranges[i] })),
      };
    }

    case "map": {
      // Simulate a drone flight path around San Francisco
      const ts = timestamps(30, 10_000);
      const baseLat = 37.7749;
      const baseLng = -122.4194;
      const lats = Array.from(
        { length: 30 },
        (_, i) =>
          +(baseLat + Math.sin((i / 30) * Math.PI * 2) * 0.01).toFixed(6),
      );
      const lngs = Array.from(
        { length: 30 },
        (_, i) =>
          +(baseLng + Math.cos((i / 30) * Math.PI * 2) * 0.01).toFixed(6),
      );
      return {
        "demo:latitude": ts.map((t, i) => ({ timestamp: t, value: lats[i] })),
        "demo:longitude": ts.map((t, i) => ({ timestamp: t, value: lngs[i] })),
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

    case "attitude": {
      const ts = timestamps(60, 1_000); // 60s of attitude data
      const roll = sine(60, 5, 0, 0.5);
      const pitch = sine(60, 3, 2, 0.3);
      const yaw = sine(60, 10, 45, 0.2);
      return {
        "demo:roll": ts.map((t, i) => ({
          timestamp: t,
          value: +roll[i].toFixed(2),
        })),
        "demo:pitch": ts.map((t, i) => ({
          timestamp: t,
          value: +pitch[i].toFixed(2),
        })),
        "demo:heading": ts.map((t, i) => ({
          timestamp: t,
          value: +yaw[i].toFixed(2),
        })),
      };
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

    case "calendar": {
      const ts = timestamps(10, 86_400_000); // 10 days
      const counts = [2, 0, 1, 3, 0, 1, 2, 0, 4, 1];
      return {
        "demo:event_count": ts.map((t, i) => ({
          timestamp: t,
          value: counts[i],
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
    case "text":
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
