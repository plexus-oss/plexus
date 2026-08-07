import { useEffect, useMemo, useState } from "react";
import type { TelemetryData, TelemetryPoint } from "@/components/dashboard/telemetry-provider";
import { downsampleLTTB } from "@/lib/data-utils";
import { formatTimeInZone } from "@/lib/timezone";

/**
 * Converts a telemetry points array into chart { x, y } points, reusing the
 * previously-converted tail when the input array has only grown at the end.
 *
 * Streaming data flows as an append-heavy sequence: each WS tick produces a
 * new array reference that shares a prefix with the previous one. Re-running
 * `new Date(ts).getTime()` across all 1000 points every tick is the biggest
 * hot path during live rendering, so we cache the last result per-metric and
 * only convert the appended tail when it's detected.
 */
type XyPoint = { x: number; y: number };
interface ConversionCacheEntry {
	input: TelemetryPoint[];
	output: XyPoint[];
}

function convertPointsWithCache(
	points: TelemetryPoint[],
	cache: Map<string, ConversionCacheEntry>,
	key: string,
): XyPoint[] {
	const prev = cache.get(key);
	// The upstream store appends in place (.push), so prev.input can be the
	// same reference as `points` while having grown. Compare against the
	// cached output's length — that's frozen at conversion time and is the
	// real "what we've already processed" marker.
	if (prev && prev.input === points && prev.output.length === points.length) {
		return prev.output;
	}
	// Detect append: prev's cached output covers a prefix of `points`. Works
	// whether `points` is a new array reference (immutable append) or the same
	// reference mutated by .push (in-place append) — both leave the original
	// prefix intact at the same indices.
	const cachedLen = prev?.output.length ?? 0;
	if (
		prev &&
		points.length >= cachedLen &&
		cachedLen > 0 &&
		points[cachedLen - 1] === prev.input[cachedLen - 1]
	) {
		const reused = prev.output;
		const appended: XyPoint[] = new Array(points.length - cachedLen);
		for (let i = 0; i < appended.length; i++) {
			const p = points[cachedLen + i];
			appended[i] = { x: new Date(p.timestamp).getTime(), y: p.value };
		}
		const next = appended.length === 0 ? reused : reused.concat(appended);
		cache.set(key, { input: points, output: next });
		return next;
	}
	// Full rebuild: array changed in a non-append way (prefix trim, reorder,
	// or first-run).
	const out: XyPoint[] = new Array(points.length);
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		out[i] = { x: new Date(p.timestamp).getTime(), y: p.value };
	}
	cache.set(key, { input: points, output: out });
	return out;
}

/** How many distinct source prefixes appear among qualified `source:metric` keys. */
function distinctSourceCount(metrics: string[]): number {
	const sources = new Set<string>();
	for (const m of metrics) {
		if (m.includes(":")) sources.add(m.split(":")[0]);
	}
	return sources.size;
}

/**
 * Legend label for a series. Normally just the metric name (the part after the
 * `source:` prefix) — unchanged for the common single-source panel. When a
 * panel overlays MORE THAN ONE source, we prefix the source so the same metric
 * from different sources is distinguishable (e.g. "drone-001 · battery_voltage"
 * vs "drone-002 · battery_voltage").
 */
function seriesLabel(metric: string, multiSource: boolean): string {
	if (!metric.includes(":")) return metric;
	const parts = metric.split(":");
	const name = parts[1];
	if (!multiSource) return name || metric;
	return name ? `${parts[0]} · ${name}` : parts[0];
}

export interface ChartSeries {
	name: string;
	color: string;
	data: Array<{ x: number; y: number }>;
	dashed?: boolean;
	areaFill?: boolean;
}

/** Bar chart series have string x values (time labels) */
export interface BarChartSeries {
	name: string;
	color: string;
	data: Array<{ x: string; y: number }>;
	dashed?: boolean;
	areaFill?: boolean;
}

interface UseChartSeriesOptions {
	data: TelemetryData | null;
	displayedMetrics: string[];
	sourceId: string | null;
	xAxisField?: string;
	colors: string[];
	metricColors: Record<string, string>;
	chartType: string;
	showFutureDashing: boolean;
	chartWidth: number;
	tz: string;
	tz12: boolean;
	/** How bar charts reduce sub-buckets past MAX_BARS. Counts must sum —
	 *  averaging "users per day" bars silently understates totals. Gauge-style
	 *  measures keep the avg default. */
	barAggregate?: "avg" | "sum";
}

interface UseChartSeriesResult {
	/** Time-based series (used for crosshair lookup, always number x) */
	timeSeries: ChartSeries[];
	/** Final series passed to chart — bar charts have string x values */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	activeSeries: any[];
}

/**
 * Converts raw telemetry data into chart series with decimation,
 * future-dashing, and bar bucketing applied.
 */
export function useChartSeries({
	data,
	displayedMetrics,
	sourceId,
	xAxisField,
	colors,
	metricColors,
	chartType,
	showFutureDashing,
	chartWidth,
	tz,
	tz12,
	barAggregate = "avg",
}: UseChartSeriesOptions): UseChartSeriesResult {
	// Per-metric conversion cache, keyed by resolved data key. Held in state
	// (lazy init) so the same Map instance persists across renders, letting
	// incremental appends avoid re-work — without reading a ref during render.
	const [conversionCache] = useState(
		() => new Map<string, ConversionCacheEntry>(),
	);

	// ── Base series: convert telemetry → { x, y } points ──
	const baseSeries = useMemo(() => {
		if (!data || Object.keys(data).length === 0) return [];
		const cache = conversionCache;

		// Custom X-axis field (metric vs metric plotting)
		if (xAxisField) {
			const xAxisData = data[xAxisField] || [];
			if (xAxisData.length === 0) return [];

			const xValueByTimestamp = new Map<string, number>();
			for (const point of xAxisData) {
				xValueByTimestamp.set(point.timestamp, point.value);
			}

			const yMetrics = displayedMetrics.filter((m) => m !== xAxisField);
			const multiSource = distinctSourceCount(yMetrics) > 1;
			return yMetrics
				.map((metric, idx) => {
					const qualifiedKey = sourceId ? `${sourceId}:${metric}` : metric;
					const points = data[qualifiedKey] || data[metric] || [];
					return {
						name: seriesLabel(metric, multiSource),
						color: metricColors[metric] || colors[idx % colors.length],
						data: points
							.filter((p) => xValueByTimestamp.has(p.timestamp))
							.map((p) => ({
								x: xValueByTimestamp.get(p.timestamp)!,
								y: p.value,
							})),
					};
				})
				.filter((s) => s.data.length > 0);
		}

		// Standard time-based series
		const metricsToProcess =
			displayedMetrics.length > 0 ? displayedMetrics : Object.keys(data);
		const multiSource = distinctSourceCount(metricsToProcess) > 1;

		let colorIndex = 0;
		const allSeries: ChartSeries[] = [];
		// Dedupe when two displayedMetrics entries resolve to the same underlying
		// data array (e.g. "accel_x_g" and "desk-pi-imu:accel_x_g" both falling
		// back to data["desk-pi-imu:accel_x_g"]). Without this, a stale saved
		// config draws two overlapping series.
		const seenDataKeys = new Set<string>();

		for (const metric of metricsToProcess) {
			const qualifiedKey = sourceId ? `${sourceId}:${metric}` : metric;
			const resolvedKey = data[qualifiedKey] ? qualifiedKey : metric;
			const points = data[resolvedKey] || [];
			if (points.length === 0) continue;
			if (seenDataKeys.has(resolvedKey)) continue;
			seenDataKeys.add(resolvedKey);

			allSeries.push({
				name: seriesLabel(metric, multiSource),
				color: metricColors[metric] || colors[colorIndex % colors.length],
				data: convertPointsWithCache(points, cache, resolvedKey),
			});
			colorIndex++;
		}

		// Drop cache entries for metrics we no longer display so the map
		// doesn't grow unbounded across the session.
		if (cache.size > seenDataKeys.size * 2) {
			for (const key of cache.keys()) {
				if (!seenDataKeys.has(key)) cache.delete(key);
			}
		}

		return allSeries;
	}, [
		data,
		displayedMetrics,
		sourceId,
		xAxisField,
		colors,
		metricColors,
		conversionCache,
	]);

	// Wall-clock "now" for the past/future split, refreshed each second while
	// future-dashing is on. Sampling via state keeps Date.now() out of render.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!showFutureDashing) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [showFutureDashing]);

	// ── Future dashing: split at "now" — past solid, future dashed ──
	const dashedSeries = useMemo(() => {
		if (!showFutureDashing || baseSeries.length === 0) return baseSeries;

		const futureThreshold = now + 5_000;

		const hasFutureData = baseSeries.some((s) =>
			s.data.some((p) => p.x > futureThreshold),
		);
		if (!hasFutureData) return baseSeries;

		const result: ChartSeries[] = [];
		for (const s of baseSeries) {
			const pastPoints = s.data.filter((p) => p.x <= now);
			const futurePoints = s.data.filter((p) => p.x > now);
			if (pastPoints.length > 0) {
				result.push({ ...s, data: pastPoints });
			}
			if (futurePoints.length > 0) {
				result.push({
					...s,
					name: s.name,
					data: futurePoints,
					dashed: true,
					areaFill: false,
				});
			}
		}
		return result;
	}, [baseSeries, showFutureDashing, now]);

	// ── Decimation: LTTB downsample based on chart width ──
	const decimatedSeries = useMemo(() => {
		if (dashedSeries.length === 0 || chartWidth === 0) return dashedSeries;
		const pointBudget = Math.max(200, chartWidth * 2);
		return dashedSeries.map((s) => {
			if (s.data.length <= pointBudget) return s;
			return { ...s, data: downsampleLTTB(s.data, pointBudget) };
		});
	}, [dashedSeries, chartWidth]);

	// ── Bar bucketing: aggregate time-series into labeled buckets ──
	const finalSeries = useMemo(() => {
		if (chartType !== "bar" || decimatedSeries.length === 0)
			return decimatedSeries;

		const MAX_BARS = 20;
		return decimatedSeries.map((s) => {
			if (s.data.length <= MAX_BARS) {
				return {
					...s,
					data: s.data.map((d) => ({
						x: formatTimeInZone(new Date(d.x), tz, tz12),
						y: d.y,
					})),
				};
			}

			const sorted = [...s.data].sort((a, b) => a.x - b.x);
			const minX = sorted[0].x;
			const maxX = sorted[sorted.length - 1].x;
			const bucketSize = (maxX - minX) / MAX_BARS;

			const buckets: Array<{ sum: number; count: number; midX: number }> = [];
			for (let i = 0; i < MAX_BARS; i++) {
				buckets.push({
					sum: 0,
					count: 0,
					midX: minX + (i + 0.5) * bucketSize,
				});
			}
			for (const d of sorted) {
				const idx = Math.min(
					Math.floor((d.x - minX) / bucketSize),
					MAX_BARS - 1,
				);
				buckets[idx].sum += d.y;
				buckets[idx].count++;
			}

			return {
				...s,
				data: buckets
					.filter((b) => b.count > 0)
					.map((b) => ({
						x: formatTimeInZone(new Date(b.midX), tz, tz12),
						y: barAggregate === "sum" ? b.sum : b.sum / b.count,
					})),
			};
		});
	}, [chartType, decimatedSeries, tz, tz12, barAggregate]);

	return { timeSeries: decimatedSeries, activeSeries: finalSeries };
}
