"use client";

import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ChartAxes,
	ChartRoot,
	ChartTooltip,
	getDomain,
	useBaseChart,
	type Margin,
	type Point,
	type WebGLRenderer,
	type WebGPURenderer,
} from "./base-chart";
import { ReferenceLines } from "./reference-lines";
import type { ReferenceLine } from "./reference-lines";
import { cn } from "@/lib/utils";
import {
	createUnifiedWebGLRenderer,
	createUnifiedWebGPURenderer,
	type UnifiedRendererProps,
	type UnifiedSeries,
} from "./unified-renderer";

// ============================================================================
// Types
// ============================================================================

export type { UnifiedSeries };

// Stable defaults so unset props don't create new objects per render,
// which would cascade into every downstream memo's deps and force re-renders.
const EMPTY_AXIS = {};

export interface UnifiedChartProps {
	type: "line" | "area" | "bar" | "scatter";
	series: UnifiedSeries[];
	xAxis?: {
		label?: string;
		domain?: [number, number] | "auto";
		formatter?: (value: number) => string;
	};
	yAxis?: {
		label?: string;
		domain?: [number, number] | "auto";
		formatter?: (value: number) => string;
	};
	width?: number | string;
	height?: number | string;
	margin?: Margin;
	showGrid?: boolean;
	showAxes?: boolean;
	showXAxis?: boolean;
	showYAxis?: boolean;
	showTooltip?: boolean;
	showLegend?: boolean;
	smooth?: boolean;
	showDataPoints?: boolean;
	referenceLines?: ReferenceLine[];
	className?: string;
	preferWebGPU?: boolean;
	// Area-specific
	stacked?: boolean;
	// Bar-specific
	orientation?: "vertical" | "horizontal";
	barWidth?: number;
	grouped?: boolean;
}

// ============================================================================
// Context
// ============================================================================

interface UnifiedChartContextType {
	type: "line" | "area" | "bar" | "scatter";
	series: UnifiedSeries[];
	smooth: boolean;
	showDataPoints: boolean;
	stacked: boolean;
	orientation: "vertical" | "horizontal";
	grouped: boolean;
	barWidth?: number;
	/** Bar charts only: category label → slot index (null for other types). */
	categoryMap: Map<string | number, number> | null;
}

const UnifiedChartContext = createContext<UnifiedChartContextType | null>(null);

function useUnifiedChartData() {
	const ctx = useContext(UnifiedChartContext);
	if (!ctx)
		throw new Error("UnifiedChart components must be used within UnifiedChart");
	return ctx;
}

function useUnifiedChart() {
	return { ...useBaseChart(), ...useUnifiedChartData() };
}

// ============================================================================
// Canvas — Single renderer for all chart types
// ============================================================================

function Canvas({ showGrid = false }: { showGrid?: boolean }) {
	const ctx = useUnifiedChart();
	// Read the canvas ref (and its sized dimensions) straight from the base
	// chart context. Going through the merged `useUnifiedChart()` spread loses
	// the ref's identity, so the compiler treats `ctx.canvasRef`/its `.current`
	// as a non-ref hook value (flagging ref access in render and mutation of
	// canvas.width). The direct read keeps it a real, mutable ref.
	const { canvasRef, width: viewWidth, height: viewHeight } = useBaseChart();
	const rendererRef = useRef<
		| WebGLRenderer<UnifiedRendererProps>
		| WebGPURenderer<UnifiedRendererProps>
		| null
	>(null);
	const [rendererReady, setRendererReady] = useState(false);

	// Init renderer once per mount. Resize lives in a separate effect below so
	// panel-dragging or window-resize doesn't destroy + recompile shaders +
	// re-upload GPU buffers on every dimension change — that used to stutter
	// the chart during any size change. The render effect below picks up new
	// dimensions automatically because `width`/`height` are in its deps.
	useEffect(() => {
		const canvas = ctx.canvasRef.current;
		if (!canvas) return;

		// rendererReady is already false here on mount (initial state) and on
		// re-runs (the cleanup below resets it before the next run), so there's
		// no need to set it synchronously in the effect body.
		let mounted = true;

		async function initRenderer() {
			if (!canvas) return;
			try {
				if (ctx.preferWebGPU && "gpu" in navigator) {
					const adapter = await navigator.gpu?.requestAdapter();
					if (adapter) {
						const device = await adapter.requestDevice();
						const renderer = createUnifiedWebGPURenderer(canvas, device);
						if (!mounted) {
							renderer.destroy();
							return;
						}
						rendererRef.current = renderer;
						ctx.setRenderMode("webgpu");
						setRendererReady(true);
						return;
					}
				}
			} catch (error) {
				console.warn("WebGPU failed, falling back to WebGL:", error);
			}
			try {
				const renderer = createUnifiedWebGLRenderer(canvas);
				if (!mounted) {
					renderer.destroy();
					return;
				}
				rendererRef.current = renderer;
				ctx.setRenderMode("webgl");
				setRendererReady(true);
			} catch (error) {
				console.error("WebGL failed:", error);
			}
		}

		initRenderer();
		return () => {
			mounted = false;
			setRendererReady(false);
			rendererRef.current?.destroy();
			rendererRef.current = null;
		};
		// `ctx` is a fresh merged object each render; depend on the specific
		// stable fields so the renderer inits once per mount, not every render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ctx.preferWebGPU, ctx.canvasRef, ctx.setRenderMode]);

	// Resize: just reset the canvas backing store and CSS size — no teardown.
	// The render effect below re-runs when width/height/dpr change and redraws
	// at the new dimensions using the existing renderer.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const dpr = ctx.devicePixelRatio;
		canvas.width = ctx.width * dpr;
		canvas.height = ctx.height * dpr;
		canvas.style.width = `${ctx.width}px`;
		canvas.style.height = `${ctx.height}px`;
	}, [canvasRef, ctx.width, ctx.height, ctx.devicePixelRatio]);

	// Render
	useEffect(() => {
		const renderer = rendererRef.current;
		if (!renderer || !ctx.renderMode || !rendererReady || !ctx.isVisible)
			return;

		const dpr = ctx.devicePixelRatio;
		let rafId: number | null = null;

		async function render() {
			const r = rendererRef.current;
			const c = ctx.canvasRef.current;
			if (!r || !c) return;
			await r.render({
				canvas: c,
				type: ctx.type,
				series: ctx.series,
				xDomain: ctx.xDomain,
				yDomain: ctx.yDomain,
				xTicks: ctx.xTicks,
				yTicks: ctx.yTicks,
				width: ctx.width * dpr,
				height: ctx.height * dpr,
				margin: {
					top: ctx.margin.top * dpr,
					right: ctx.margin.right * dpr,
					bottom: ctx.margin.bottom * dpr,
					left: ctx.margin.left * dpr,
				},
				showGrid,
				smooth: ctx.smooth,
				stacked: ctx.stacked,
				orientation: ctx.orientation,
				barWidth: ctx.barWidth ? ctx.barWidth * dpr : undefined,
				grouped: ctx.grouped,
				categoryMap: ctx.categoryMap ?? undefined,
			});
		}

		rafId = requestAnimationFrame(() => render());
		return () => {
			if (rafId !== null) cancelAnimationFrame(rafId);
		};
	}, [
		ctx.type,
		ctx.series,
		ctx.xDomain,
		ctx.yDomain,
		ctx.xTicks,
		ctx.yTicks,
		ctx.width,
		ctx.height,
		ctx.margin,
		ctx.devicePixelRatio,
		ctx.renderMode,
		ctx.canvasRef,
		ctx.isVisible,
		ctx.smooth,
		ctx.stacked,
		ctx.orientation,
		ctx.barWidth,
		ctx.grouped,
		ctx.categoryMap,
		showGrid,
		rendererReady,
	]);

	return (
		<canvas
			ref={canvasRef}
			className="absolute inset-0"
			style={{ width: `${viewWidth}px`, height: `${viewHeight}px` }}
		/>
	);
}

// ============================================================================
// DataPoints — SVG overlay for line/scatter data point dots
// ============================================================================

function DataPoints() {
	const ctx = useUnifiedChart();
	if (!ctx.showDataPoints || ctx.type === "scatter" || ctx.type === "bar")
		return null;

	return (
		<svg
			className="absolute inset-0 pointer-events-none z-10"
			style={{ width: ctx.width, height: ctx.height }}
		>
			{ctx.series.map((s, sIdx) =>
				s.data.map((p, pIdx) => {
					const cx = ctx.xScale(p.x);
					const cy = ctx.yScale(p.y);
					if (cx < ctx.margin.left || cx > ctx.width - ctx.margin.right)
						return null;
					if (cy < ctx.margin.top || cy > ctx.height - ctx.margin.bottom)
						return null;
					return (
						<circle
							key={`${sIdx}-${pIdx}`}
							cx={cx}
							cy={cy}
							r={1.5}
							fill={s.color || "#6366f1"}
						/>
					);
				}),
			)}
		</svg>
	);
}

// ============================================================================
// Legend
// ============================================================================

function Legend() {
	const ctx = useUnifiedChart();
	if (ctx.series.length === 0) return null;

	// Deduplicate by name (future-dashed series share names)
	const seen = new Set<string>();
	const unique = ctx.series.filter((s) => {
		if (seen.has(s.name)) return false;
		seen.add(s.name);
		return true;
	});

	return (
		// Floating chip cluster — absolutely positioned so the legend NEVER
		// takes or overlays plot space unpredictably (it used to render as a
		// flow child inside the relative chart container, painting over the
		// canvas). Top-right, under the annotation-mode indicator's z-20.
		<div className="absolute top-2 right-2 z-10 pointer-events-none flex flex-wrap justify-end gap-1 max-w-[65%]">
			{unique.map((s, idx) => (
				<div
					key={idx}
					className="flex items-center gap-1.5 rounded-full border border-border/50 bg-popover/85 px-2 py-0.5 text-[10px]"
				>
					<div
						className="w-3 h-0.5 rounded-full shrink-0"
						style={{ backgroundColor: s.color || "#6366f1" }}
					/>
					<span
						className={cn(
							"truncate max-w-[160px]",
							s.isGhost ? "text-muted-foreground/80" : "text-muted-foreground",
						)}
					>
						{s.name}
					</span>
				</div>
			))}
		</div>
	);
}

// ============================================================================
// Tooltip
// ============================================================================

function Tooltip() {
	const ctx = useUnifiedChart();

	// Bar points carry category labels as x; resolve them to slot indices so
	// the scale math below stays numeric.
	const catMap = ctx.type === "bar" ? ctx.categoryMap : null;
	const xOf = (p: Point) =>
		catMap ? (catMap.get(p.x as unknown as string | number) ?? 0) : p.x;

	const handleHover = (e: React.MouseEvent<HTMLDivElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		if (
			x < ctx.margin.left ||
			x > ctx.width - ctx.margin.right ||
			y < ctx.margin.top ||
			y > ctx.height - ctx.margin.bottom
		) {
			ctx.setHoveredPoint(null);
			ctx.setTooltipData(null);
			return;
		}

		// Find closest X across all series
		let closestXDist = Infinity;
		let closestXValue = 0;
		let closestScreenX = 0;
		const domainRange = ctx.xDomain[1] - ctx.xDomain[0];
		const threshold = Math.max(50, (domainRange / 800) * 100);

		for (const s of ctx.series) {
			for (const p of s.data) {
				const px = ctx.xScale(xOf(p));
				const dist = Math.abs(px - x);
				if (dist < threshold && dist < closestXDist) {
					closestXDist = dist;
					closestXValue = xOf(p);
					closestScreenX = px;
				}
			}
		}

		if (closestXDist === Infinity) {
			ctx.setHoveredPoint(null);
			ctx.setTooltipData(null);
			return;
		}

		// Per-series nearest point within 2% of the domain. The old exact-match
		// gate (0.1%) assumed every series shares sample instants — a
		// time-shifted comparison ghost (or any independently-sampled series)
		// almost never does, so it silently vanished from the tooltip.
		const xThresh = Math.max(domainRange * 0.02, 1);
		const items: Array<{ label: string; value: string; color?: string }> = [];
		let primaryScreenY = 0;

		for (const s of ctx.series) {
			let closest: Point | null = null;
			let closestD = Infinity;
			for (const p of s.data) {
				const d = Math.abs(xOf(p) - closestXValue);
				if (d < xThresh && d < closestD) {
					closestD = d;
					closest = p;
				}
			}
			if (closest) {
				if (items.length === 0) primaryScreenY = ctx.yScale(closest.y);
				const yFmt = ctx.yAxis?.formatter;
				items.push({
					label: s.name,
					value: yFmt ? yFmt(closest.y) : closest.y.toFixed(2),
					color: s.color || "#6366f1",
				});
			}
		}

		if (items.length === 0) return;

		const xFmt = ctx.xAxis?.formatter;
		ctx.setHoveredPoint({
			seriesIdx: 0,
			pointIdx: 0,
			screenX: closestScreenX,
			screenY: primaryScreenY,
			data: { xValue: closestXValue },
		});
		ctx.setTooltipData({
			title: xFmt ? xFmt(closestXValue) : closestXValue.toFixed(2),
			items,
		});
	};

	const dots = useMemo(() => {
		const hData = ctx.hoveredPoint?.data as { xValue?: number } | undefined;
		// == null (not falsy): bar slot indices start at 0.
		if (hData?.xValue == null) return null;
		// Same nearest-within-tolerance rule as the item loop above.
		const xThresh = Math.max((ctx.xDomain[1] - ctx.xDomain[0]) * 0.02, 1);
		return ctx.series
			.map((s) => {
				let p: Point | null = null;
				let closestD = Infinity;
				for (const pt of s.data) {
					const d = Math.abs(xOf(pt) - hData.xValue!);
					if (d < xThresh && d < closestD) {
						closestD = d;
						p = pt;
					}
				}
				if (!p) return null;
				return {
					screenX: ctx.xScale(xOf(p)),
					screenY: ctx.yScale(p.y),
					color: s.color || "#6366f1",
					isGhost: s.isGhost === true,
				};
			})
			.filter(Boolean) as Array<{
			screenX: number;
			screenY: number;
			color: string;
			isGhost: boolean;
		}>;
		// `ctx` is a fresh merged object each render; depend on the specific
		// fields used so the memo only recomputes when those actually change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ctx.hoveredPoint, ctx.series, ctx.xScale, ctx.yScale, ctx.xDomain, ctx.categoryMap, ctx.type]);

	return (
		<>
			<ChartTooltip onHover={handleHover} />
			{ctx.hoveredPoint &&
				dots?.map((dot, idx) =>
					dot.isGhost ? (
						// Ghost hover dot: small and dim — the baseline is context,
						// not the subject (metric-chart's now-vs-prior grammar).
						<div
							key={idx}
							className="absolute pointer-events-none z-20"
							style={{ left: dot.screenX - 3, top: dot.screenY - 3 }}
						>
							<div
								className="w-1.5 h-1.5 rounded-full opacity-60"
								style={{ backgroundColor: dot.color }}
							/>
						</div>
					) : (
						<div
							key={idx}
							className="absolute pointer-events-none z-20"
							style={{ left: dot.screenX - 6, top: dot.screenY - 6 }}
						>
							<div
								className="w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900"
								style={{ backgroundColor: dot.color }}
							/>
						</div>
					),
				)}
		</>
	);
}

// ============================================================================
// Root
// ============================================================================

function Root({
	type,
	series,
	xAxis = EMPTY_AXIS,
	yAxis = EMPTY_AXIS,
	width = 800,
	height = 400,
	margin,
	preferWebGPU = true,
	smooth = true,
	showDataPoints = false,
	stacked = false,
	orientation = "vertical",
	grouped = false,
	barWidth,
	className,
	children,
}: {
	type: "line" | "area" | "bar" | "scatter";
	series: UnifiedSeries[];
	xAxis?: {
		label?: string;
		domain?: [number, number] | "auto";
		formatter?: (value: number) => string;
	};
	yAxis?: {
		label?: string;
		domain?: [number, number] | "auto";
		formatter?: (value: number) => string;
	};
	width?: number | string;
	height?: number | string;
	margin?: Margin;
	preferWebGPU?: boolean;
	smooth?: boolean;
	showDataPoints?: boolean;
	stacked?: boolean;
	orientation?: "vertical" | "horizontal";
	grouped?: boolean;
	barWidth?: number;
	className?: string;
	children?: React.ReactNode;
}) {
	// Bar charts plot discrete categories (e.g. time-bucket labels), not a
	// continuous axis: numeric domain math over string x values yields NaN and
	// draws nothing. Map each label to a slot index — the renderer positions
	// bars by slot (createBarGeometry). Slots keep first-seen order, which is
	// chronological for time-bucketed series; all-numeric categories sort
	// numerically.
	const { categoryMap, categoryLabels } = useMemo(() => {
		if (type !== "bar")
			return { categoryMap: null, categoryLabels: null } as {
				categoryMap: Map<string | number, number> | null;
				categoryLabels: Map<number, string> | null;
			};
		const keys: Array<string | number> = [];
		const seen = new Set<string | number>();
		for (const s of series)
			for (const p of s.data) {
				const k = p.x as string | number;
				if (!seen.has(k)) {
					seen.add(k);
					keys.push(k);
				}
			}
		if (keys.every((k) => typeof k === "number"))
			(keys as number[]).sort((a, b) => a - b);
		const map = new Map<string | number, number>();
		const labels = new Map<number, string>();
		keys.forEach((k, i) => {
			map.set(k, i);
			labels.set(i, String(k));
		});
		return { categoryMap: map, categoryLabels: labels };
	}, [type, series]);

	// Derive domains only when series content changes — otherwise a new array
	// reference per render forces ChartRoot's memos to invalidate every tick.
	// Bar: the category axis spans the slots (half-slot padding so edge bars
	// aren't clipped); the value axis is anchored at zero unless overridden.
	const xDomain = useMemo<[number, number]>(() => {
		if (categoryMap && orientation === "vertical")
			return [-0.5, Math.max(categoryMap.size, 1) - 0.5];
		if (xAxis.domain && xAxis.domain !== "auto") {
			return [xAxis.domain[0], xAxis.domain[1]];
		}
		const allPoints = series.flatMap((s) => s.data);
		if (categoryMap) {
			const [, max] = getDomain(allPoints, (p) => p.y, 0.05);
			return [0, max];
		}
		return getDomain(allPoints, (p) => p.x, 0);
	}, [series, xAxis.domain, categoryMap, orientation]);

	const yDomain = useMemo<[number, number]>(() => {
		if (categoryMap && orientation === "horizontal")
			return [-0.5, Math.max(categoryMap.size, 1) - 0.5];
		if (yAxis.domain && yAxis.domain !== "auto") {
			return [yAxis.domain[0], yAxis.domain[1]];
		}
		const allPoints = series.flatMap((s) => s.data);
		if (categoryMap) {
			const [, max] = getDomain(allPoints, (p) => p.y, 0.05);
			return [0, max];
		}
		return getDomain(allPoints, (p) => p.y, 0.1);
	}, [series, yAxis.domain, categoryMap, orientation]);

	// Category axis: one tick per slot, labeled with the category text (unless
	// the caller supplied a formatter).
	const categoryTicks = useMemo(
		() =>
			categoryMap
				? Array.from({ length: categoryMap.size }, (_, i) => i)
				: undefined,
		[categoryMap],
	);
	const xAxisEff = useMemo(() => {
		if (
			!categoryLabels ||
			orientation !== "vertical" ||
			xAxis.formatter
		)
			return xAxis;
		return {
			...xAxis,
			formatter: (v: number) => categoryLabels.get(Math.round(v)) ?? "",
		};
	}, [xAxis, categoryLabels, orientation]);
	const yAxisEff = useMemo(() => {
		if (
			!categoryLabels ||
			orientation !== "horizontal" ||
			yAxis.formatter
		)
			return yAxis;
		return {
			...yAxis,
			formatter: (v: number) => categoryLabels.get(Math.round(v)) ?? "",
		};
	}, [yAxis, categoryLabels, orientation]);

	const unifiedContextValue = useMemo(
		() => ({
			type,
			series,
			smooth,
			showDataPoints,
			stacked,
			orientation,
			grouped,
			barWidth,
			categoryMap,
		}),
		[
			type,
			series,
			smooth,
			showDataPoints,
			stacked,
			orientation,
			grouped,
			barWidth,
			categoryMap,
		],
	);

	return (
		<ChartRoot
			width={width}
			height={height}
			margin={margin}
			xAxis={xAxisEff}
			yAxis={yAxisEff}
			xDomain={xDomain}
			yDomain={yDomain}
			xTicks={orientation === "vertical" ? categoryTicks : undefined}
			yTicks={orientation === "horizontal" ? categoryTicks : undefined}
			preferWebGPU={preferWebGPU}
			className={className}
		>
			<UnifiedChartContext.Provider value={unifiedContextValue}>
				{children}
			</UnifiedChartContext.Provider>
		</ChartRoot>
	);
}

// ============================================================================
// Composed API
// ============================================================================

export function UnifiedChart({
	type,
	series,
	xAxis = EMPTY_AXIS,
	yAxis = EMPTY_AXIS,
	width = 800,
	height = 400,
	margin,
	showGrid = true,
	showAxes = true,
	showXAxis,
	showYAxis,
	showTooltip = false,
	showLegend = false,
	smooth = true,
	showDataPoints = false,
	referenceLines,
	preferWebGPU = true,
	stacked = false,
	orientation = "vertical",
	grouped = false,
	barWidth,
	className,
}: UnifiedChartProps) {
	return (
		<Root
			type={type}
			series={series}
			xAxis={xAxis}
			yAxis={yAxis}
			width={width}
			height={height}
			margin={margin}
			preferWebGPU={preferWebGPU}
			smooth={smooth}
			showDataPoints={showDataPoints}
			stacked={stacked}
			orientation={orientation}
			grouped={grouped}
			barWidth={barWidth}
			className={className}
		>
			<Canvas showGrid={showGrid} />
			{(showAxes || showXAxis || showYAxis) && (
				<ChartAxes
					showXAxis={showXAxis ?? showAxes}
					showYAxis={showYAxis ?? showAxes}
				/>
			)}
			{showTooltip && <Tooltip />}
			{showLegend && <Legend />}
			<DataPoints />
			{referenceLines && referenceLines.length > 0 && (
				<ReferenceLines lines={referenceLines} />
			)}
		</Root>
	);
}

UnifiedChart.Root = Root;
UnifiedChart.Canvas = Canvas;
UnifiedChart.Axes = ChartAxes;
UnifiedChart.Tooltip = Tooltip;
UnifiedChart.Legend = Legend;
UnifiedChart.displayName = "UnifiedChart";

