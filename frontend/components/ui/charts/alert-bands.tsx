"use client";

import { useMemo } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { Alert } from "@/lib/db/types";
import {
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTimeInZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";

// Use TooltipPrimitive.Root (not the styled `Tooltip` wrapper from
// /components/ui/tooltip) so we can share ONE TooltipProvider across
// every band. The wrapper version embeds a per-Tooltip provider, which
// fails on dynamically-mounted bands: when polling brings in a new
// alert mid-session, its fresh provider hasn't seen any pointer events
// and the tooltip silently no-ops until full page reload.
const TooltipRoot = TooltipPrimitive.Root;

interface AlertBandsProps {
	alerts: Alert[];
	xDomain: [number, number];
	margin: { top: number; right: number; bottom: number; left: number };
	innerWidth: number;
	innerHeight: number;
	tz: string;
	tz12: boolean;
	/** Called with an alert id when a band is clicked. Bands are non-interactive if omitted. */
	onAlertClick?: (alertId: string) => void;
	/** Last observed data point (epoch ms) — open alerts never extend past it. */
	dataEndMs?: number;
}

// Severity palette matches ReferenceLines / AlertsPanel conventions.
const SEVERITY_RGB = {
	critical: "239, 68, 68", // red-500
	warning: "245, 158, 11", // amber-500
	info: "59, 130, 246", // blue-500
} as const;

interface BandGeometry {
	alert: Alert;
	left: number;
	width: number;
	clippedLeft: boolean;
	clippedRight: boolean;
	ongoing: boolean;
}

function severityRgb(severity: Alert["severity"]): string {
	return SEVERITY_RGB[severity] ?? SEVERITY_RGB.info;
}

function formatRelDuration(ms: number): string {
	const abs = Math.abs(ms);
	if (abs < 1000) return `${Math.round(abs)}ms`;
	if (abs < 60_000) return `${(abs / 1000).toFixed(1)}s`;
	if (abs < 3_600_000) return `${(abs / 60_000).toFixed(1)}m`;
	if (abs < 86_400_000) return `${(abs / 3_600_000).toFixed(1)}h`;
	return `${(abs / 86_400_000).toFixed(1)}d`;
}

export function AlertBands({
	alerts,
	xDomain,
	margin,
	innerWidth,
	innerHeight,
	tz,
	tz12,
	onAlertClick,
	dataEndMs,
}: AlertBandsProps) {
	const [domainStart, domainEnd] = xDomain;
	const domainRange = domainEnd - domainStart;

	// Recompute pixel geometry whenever the domain or alerts shift (e.g. pan/zoom).
	// "now" is pinned per render for open alerts so their right edge doesn't
	// fight the animation loop — it redraws on the next render anyway.
	const bands = useMemo<BandGeometry[]>(() => {
		if (domainRange <= 0 || innerWidth <= 0) return [];
		// Use the domain's right edge as "now" for open alerts. On a live chart
		// domainEnd tracks the current time, and the band is clamped to domainEnd
		// regardless — so this is geometry-equivalent while staying pure (no
		// Date.now() during render, which the React Compiler forbids).
		//
		// Open alerts extend AT MOST to the last observed data point (dataEndMs):
		// a source that stopped reporting can never "clear" its condition, so an
		// unclosed alert would otherwise paint to now, forever — covering whole
		// historical windows. We only claim a breach while we were observing it.
		const now = dataEndMs != null ? Math.min(domainEnd, dataEndMs) : domainEnd;
		const result: BandGeometry[] = [];
		for (const alert of alerts) {
			const startMs = new Date(alert.triggered_at).getTime();
			// "Ongoing" = alert-service still considers the condition active.
			// closed_at is set by the alert-service; resolved_at is set by the user
			// acknowledging — we show the real condition window, not the user action.
			const ongoing = !alert.closed_at;
			const endMs = ongoing ? now : new Date(alert.closed_at!).getTime();
			if (ongoing && endMs <= startMs) continue;
			if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
			if (endMs < domainStart || startMs > domainEnd) continue;

			const clippedLeft = startMs < domainStart;
			const clippedRight = endMs > domainEnd;
			const clampedStart = Math.max(startMs, domainStart);
			const clampedEnd = Math.min(endMs, domainEnd);

			const left =
				margin.left + ((clampedStart - domainStart) / domainRange) * innerWidth;
			const rawWidth = ((clampedEnd - clampedStart) / domainRange) * innerWidth;
			// Point-in-time alerts (resolved immediately) get a minimum hit target
			// so the band stays hoverable.
			const width = Math.max(rawWidth, 2);

			result.push({ alert, left, width, clippedLeft, clippedRight, ongoing });
		}
		return result;
	}, [alerts, domainStart, domainEnd, domainRange, innerWidth, margin.left, dataEndMs]);

	if (bands.length === 0) return null;

	return (
		// Single TooltipProvider for ALL bands, not one per band. Radix
		// docs are explicit: "Wraps your app to provide global functionality
		// to your tooltips." Per-Tooltip Providers (what the shared
		// /components/ui/tooltip.tsx wrapper does) create isolated state
		// machines that don't survive dynamic re-renders cleanly.
		//
		// delayDuration={200}: Radix triggers tooltips on `pointermove`
		// (not pointerenter — see TooltipTrigger source). When a new
		// band mounts under the user's already-stationary cursor, no
		// pointermove fires, and at delayDuration=0 the open/close state
		// can race. A modest 200ms delay sidesteps that.
		//
		// disableHoverableContent: simpler state machine — close fires on
		// pointerleave directly instead of tracking transit between trigger
		// and content. We don't need hover-the-content-to-keep-open here
		// because the bands carry click-through-to-detail behavior.
		<TooltipProvider delayDuration={200} disableHoverableContent>
		<div
			className="absolute inset-0 pointer-events-none z-10"
			aria-hidden={false}
		>
			{bands.map(
				({ alert, left, width, clippedLeft, clippedRight, ongoing }) => {
					const rgb = severityRgb(alert.severity);
					const triggeredLabel = formatDateTimeInZone(
						new Date(alert.triggered_at),
						tz,
						tz12,
					);
					const resolvedLabel = alert.closed_at
						? formatDateTimeInZone(new Date(alert.closed_at), tz, tz12)
						: null;
					const durationMs = ongoing
						? domainEnd - new Date(alert.triggered_at).getTime()
						: new Date(alert.closed_at!).getTime() -
							new Date(alert.triggered_at).getTime();
					const boundLabel =
						alert.bound && alert.threshold != null
							? `${alert.bound} ${alert.threshold}`
							: null;
					const interactive = !!onAlertClick;

					return (
						<TooltipRoot key={alert.id}>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={
										interactive ? () => onAlertClick!(alert.id) : undefined
									}
									// Stop mousedown bubbling so the chart's pan/zoom handler
									// doesn't treat hovering/clicking a band as the start of a
									// drag. Pan still works from any non-band area.
									onMouseDown={(e) => e.stopPropagation()}
									className={cn(
										"absolute pointer-events-auto border-0 p-0 m-0 bg-transparent",
										interactive ? "cursor-pointer" : "cursor-help",
										"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									)}
									style={{
										left,
										top: margin.top,
										width,
										height: innerHeight,
									}}
									aria-label={`${alert.severity} alert on ${alert.metric} at ${triggeredLabel}`}
								>
									<span
										className="absolute inset-0 block"
										style={{
											backgroundColor: `rgba(${rgb}, 0.12)`,
											// Left border marks the trigger instant; suppress if clipped
											// so the overlap with the chart edge doesn't look like a
											// second event.
											borderLeft: clippedLeft
												? undefined
												: `2px solid rgba(${rgb}, 0.9)`,
											// Right border marks the resolution. For open/ongoing alerts
											// and right-clipped bands, we leave it open to signal
											// continuation.
											borderRight:
												clippedRight || ongoing
													? undefined
													: `2px dashed rgba(${rgb}, 0.6)`,
										}}
									/>
								</button>
							</TooltipTrigger>
							<TooltipContent
								side="top"
								align="start"
								className="max-w-xs bg-popover text-popover-foreground border border-border shadow-md p-0"
							>
								<div className="flex flex-col gap-1.5 p-2.5 text-xs">
									<div className="flex items-center gap-2">
										<span
											className="inline-block size-2 rounded-full"
											style={{ backgroundColor: `rgb(${rgb})` }}
										/>
										<span className="font-medium uppercase tracking-wide text-[10px]">
											{alert.severity}
										</span>
										<span className="text-muted-foreground">·</span>
										<span className="font-mono">{alert.metric}</span>
									</div>

									{(alert.value != null || boundLabel) && (
										<div className="text-muted-foreground">
											{alert.value != null && (
												<span className="font-mono">{alert.value}</span>
											)}
											{boundLabel && (
												<>
													<span className="mx-1">·</span>
													<span>threshold {boundLabel}</span>
												</>
											)}
										</div>
									)}

									<div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
										<span>Opened</span>
										<span className="font-mono text-foreground">
											{triggeredLabel}
										</span>
										<span>{ongoing ? "Active" : "Closed"}</span>
										<span className="font-mono text-foreground">
											{resolvedLabel ?? `ongoing (${formatRelDuration(durationMs)})`}
										</span>
										{!ongoing && (
											<>
												<span>Duration</span>
												<span className="font-mono text-foreground">
													{formatRelDuration(durationMs)}
												</span>
											</>
										)}
										<span>Status</span>
										<span className="text-foreground capitalize">
											{alert.status}
										</span>
									</div>
								</div>
							</TooltipContent>
						</TooltipRoot>
					);
				},
			)}
		</div>
		</TooltipProvider>
	);
}
