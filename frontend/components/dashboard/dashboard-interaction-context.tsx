"use client";

import {
	createContext,
	useContext,
	useState,
	useCallback,
	useMemo,
	type ReactNode,
} from "react";
import type { TimeRange } from "@/lib/types/dashboard";

/**
 * Per-panel hovered values for synchronized tooltips.
 */
export interface HoveredValue {
	name: string;
	value: number;
	color: string;
}

/**
 * Transient view window for instant visual feedback during pan/zoom.
 * Overrides the chart domain without triggering data re-fetch.
 */
export interface ViewWindow {
	start: number;
	end: number;
}

/**
 * Per-run comparison colors — warm hues deliberately far from the blue/violet
 * default series palette. Baseline #1 orange, #2 yellow, #3 pink… ALL of a
 * baseline's traces render in its single run color (per-run identity, not
 * per-metric — the only scheme that stays legible with n runs).
 */
export const RUN_COMPARE_COLORS = [
	"#f97316", // orange
	"#facc15", // yellow
	"#ec4899", // pink
	"#2dd4bf", // teal
	"#a3e635", // lime
];

/**
 * A baseline test run overlaid across every chart panel for run-to-run
 * comparison. Set from the toolbar Compare picker; each panel fetches the
 * run's window independently and renders it as a time-shifted ghost series.
 */
export interface CompareRun {
	id: string;
	/** Absolute window "startISO/endISO" of the baseline run */
	window: string;
	label: string;
	/** Run start epoch ms — the point that gets shifted onto alignTarget */
	startedAt: number;
	/**
	 * Epoch ms where the baseline's start lands on every chart: the primary
	 * run's start when one is known (live active run, or the most recent other
	 * run — selection FRAMES the view around it), else the window start.
	 * Resolved ONCE at selection time so all panels shift identically and the
	 * ghost stays pinned in time.
	 */
	alignTarget: number;
	/** Name of the primary run the baseline is compared against (null = current view) */
	primaryLabel: string | null;
	/** Source uuid the run belongs to (null = org-wide) */
	sourceId: string | null;
	/** This baseline's trace color (RUN_COMPARE_COLORS by selection order) */
	color: string;
}

/**
 * Shared interaction state across all dashboard panels.
 * Enables cross-panel cursor sync, linked time-range changes, and value tooltips.
 */
interface DashboardInteractionContextType {
	/** ISO timestamp string of the currently hovered point (shared across panels) */
	hoveredTimestamp: string | null;
	setHoveredTimestamp: (timestamp: string | null) => void;
	/** Change the dashboard time range (used by pan-zoom, time picker, etc.) */
	onTimeRangeChange: (timeRange: TimeRange) => void;
	/** Transient view window during active pan/zoom — overrides chart domain for instant feedback */
	viewWindow: ViewWindow | null;
	/** Set the transient view window (instant visual preview, no data fetch) */
	setViewWindow: (window: ViewWindow | null) => void;
	/** Per-panel hovered values at the cursor timestamp */
	hoveredValues: Record<string, HoveredValue[]>;
	/** Set hovered values for a panel */
	setHoveredValues: (panelId: string, values: HoveredValue[]) => void;
	/** Clear hovered values for a panel */
	clearHoveredValues: (panelId: string) => void;
	/** Register timestamps for a panel (used by time scrubber density histogram) */
	registerPanelTimestamps: (panelId: string, timestamps: number[]) => void;
	/** Unregister timestamps when a panel unmounts */
	unregisterPanelTimestamps: (panelId: string) => void;
	/** All timestamps across all panels (flattened) */
	allPanelTimestamps: number[];
	/** True when in live mode (relative time range) */
	isLive: boolean;
	/** Exit historical mode and resume live with the last relative range */
	goLive: () => void;
	/** Show synced crosshair on all panels when hovering one */
	syncTooltips: boolean;
	/** The last relative time range value (e.g. "15m") — used for Go Live */
	lastRelativeValue: string;
	/** Baseline runs overlaid on all chart panels (empty = compare off) */
	compareRuns: CompareRun[];
	setCompareRuns: (runs: CompareRun[]) => void;
}

const DashboardInteractionContext =
	createContext<DashboardInteractionContextType>({
		hoveredTimestamp: null,
		setHoveredTimestamp: () => {},
		onTimeRangeChange: () => {},
		viewWindow: null,
		setViewWindow: () => {},
		hoveredValues: {},
		setHoveredValues: () => {},
		clearHoveredValues: () => {},
		registerPanelTimestamps: () => {},
		unregisterPanelTimestamps: () => {},
		allPanelTimestamps: [],
		isLive: true,
		goLive: () => {},
		syncTooltips: false,
		lastRelativeValue: "15m",
		compareRuns: [],
		setCompareRuns: () => {},
	});

export function useDashboardInteraction() {
	return useContext(DashboardInteractionContext);
}

interface DashboardInteractionProviderProps {
	children: ReactNode;
	currentTimeRange: TimeRange;
	onTimeRangeChange: (timeRange: TimeRange) => void;
	syncTooltips?: boolean;
}

export function DashboardInteractionProvider({
	children,
	currentTimeRange,
	onTimeRangeChange,
	syncTooltips = false,
}: DashboardInteractionProviderProps) {
	const [hoveredTimestamp, setHoveredTimestamp] = useState<string | null>(null);
	const [viewWindow, setViewWindowState] = useState<ViewWindow | null>(null);
	const [compareRuns, setCompareRuns] = useState<CompareRun[]>([]);
	const [hoveredValues, setHoveredValuesState] = useState<
		Record<string, HoveredValue[]>
	>({});
	const [panelTimestampsMap, setPanelTimestampsMap] = useState<
		Map<string, number[]>
	>(new Map());

	// Remember the last relative range so Go Live can restore it.
	const [lastRelativeValue, setLastRelativeValue] = useState(
		currentTimeRange.type === "relative" ? currentTimeRange.value : "15m",
	);

	// When the committed timeRange changes: clear the transient viewWindow (so
	// charts don't snap back to the old domain between clearing viewWindow and
	// receiving the new timeRange prop) and remember the latest relative range.
	// Done as a guarded render-time state adjustment (runs once per change)
	// rather than an effect, avoiding a synchronous setState inside an effect.
	const timeRangeKey = `${currentTimeRange.type}:${currentTimeRange.value}`;
	const [prevTimeRangeKey, setPrevTimeRangeKey] = useState(timeRangeKey);
	if (prevTimeRangeKey !== timeRangeKey) {
		setPrevTimeRangeKey(timeRangeKey);
		setViewWindowState(null);
		if (currentTimeRange.type === "relative") {
			setLastRelativeValue(currentTimeRange.value);
		}
	}

	const setViewWindow = useCallback((w: ViewWindow | null) => {
		setViewWindowState(w);
	}, []);

	const isLive = currentTimeRange.type === "relative";

	// Go Live: restore the last relative range
	const goLive = useCallback(() => {
		onTimeRangeChange({
			type: "relative",
			value: lastRelativeValue,
		});
	}, [onTimeRangeChange, lastRelativeValue]);

	const registerPanelTimestamps = useCallback(
		(panelId: string, timestamps: number[]) => {
			setPanelTimestampsMap((prev) => {
				const next = new Map(prev);
				next.set(panelId, timestamps);
				return next;
			});
		},
		[],
	);

	const unregisterPanelTimestamps = useCallback((panelId: string) => {
		setPanelTimestampsMap((prev) => {
			if (!prev.has(panelId)) return prev;
			const next = new Map(prev);
			next.delete(panelId);
			return next;
		});
	}, []);

	const allPanelTimestamps = useMemo(() => {
		const all: number[] = [];
		for (const ts of panelTimestampsMap.values()) {
			for (let i = 0; i < ts.length; i++) {
				all.push(ts[i]);
			}
		}
		return all;
	}, [panelTimestampsMap]);

	const setHoveredValues = useCallback(
		(panelId: string, values: HoveredValue[]) => {
			setHoveredValuesState((prev) => ({ ...prev, [panelId]: values }));
		},
		[],
	);

	const clearHoveredValues = useCallback((panelId: string) => {
		setHoveredValuesState((prev) => {
			if (!prev[panelId]) return prev;
			const next = { ...prev };
			delete next[panelId];
			return next;
		});
	}, []);

	const value = useMemo(
		() => ({
			hoveredTimestamp,
			setHoveredTimestamp,
			onTimeRangeChange,
			viewWindow,
			setViewWindow,
			hoveredValues,
			setHoveredValues,
			clearHoveredValues,
			registerPanelTimestamps,
			unregisterPanelTimestamps,
			allPanelTimestamps,
			isLive,
			goLive,
			syncTooltips,
			lastRelativeValue,
			compareRuns,
			setCompareRuns,
		}),
		[
			hoveredTimestamp,
			onTimeRangeChange,
			viewWindow,
			setViewWindow,
			hoveredValues,
			syncTooltips,
			setHoveredValues,
			clearHoveredValues,
			registerPanelTimestamps,
			unregisterPanelTimestamps,
			allPanelTimestamps,
			isLive,
			goLive,
			lastRelativeValue,
			compareRuns,
		],
	);

	return (
		<DashboardInteractionContext.Provider value={value}>
			{children}
		</DashboardInteractionContext.Provider>
	);
}
