"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { formatDistanceToNow } from "date-fns";
import {
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateTimeInZone } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import {
	annotationRgb,
	getAnnotationColor,
} from "@/components/annotations/colors";
import { formatRelDuration } from "@/components/annotations/format";
import type { PendingAnnotation } from "@/hooks/use-annotation-mode";

// Use TooltipPrimitive.Root (not the styled `Tooltip` wrapper from
// /components/ui/tooltip) so we can share ONE TooltipProvider across
// every marker. The wrapper version embeds a per-Tooltip provider, which
// fails on dynamically-mounted markers: when a newly created annotation
// mounts mid-session, its fresh provider hasn't seen any pointer events
// and the tooltip silently no-ops until full page reload.
const TooltipRoot = TooltipPrimitive.Root;

interface AnnotationLike {
	id: string;
	label: string | null;
	color: string | null;
	timestamp_start: string;
	timestamp_end?: string | null;
	notes?: string | null;
	created_at?: string;
}

interface ChartAnnotationOverlayProps<T extends AnnotationLike = AnnotationLike> {
	annotations: T[];
	xDomain: [number, number];
	chartWidth: number;
	innerWidth: number;
	innerHeight: number;
	margin: { top: number; left: number; right: number };
	tz: string;
	tz12: boolean;
	onAnnotationClick: (annotation: T, x: number, y: number) => void;
	pending?: PendingAnnotation | null;
}

function MarkerTooltip({
	annotation,
	tz,
	tz12,
	children,
}: {
	annotation: AnnotationLike;
	tz: string;
	tz12: boolean;
	children: React.ReactElement;
}) {
	const isRegion = !!annotation.timestamp_end;
	const startLabel = formatDateTimeInZone(
		new Date(annotation.timestamp_start),
		tz,
		tz12,
	);
	const endLabel = annotation.timestamp_end
		? formatDateTimeInZone(new Date(annotation.timestamp_end), tz, tz12)
		: null;
	const durationMs = annotation.timestamp_end
		? new Date(annotation.timestamp_end).getTime() -
			new Date(annotation.timestamp_start).getTime()
		: null;

	return (
		<TooltipRoot>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent
				side="top"
				align="center"
				sideOffset={6}
				className="max-w-[260px] bg-popover text-popover-foreground border border-border shadow-md p-0"
			>
				<div className="flex flex-col gap-1 p-2.5 text-xs">
					<div className="flex items-center gap-1.5">
						<span
							className="inline-block size-2 rounded-full shrink-0"
							style={{ backgroundColor: annotationRgb(annotation.color) }}
						/>
						<span className="font-medium truncate">
							{annotation.label || "Annotation"}
						</span>
						{isRegion && (
							<span className="rounded border border-border px-1 text-[9px] uppercase tracking-wide text-muted-foreground shrink-0">
								Range
							</span>
						)}
					</div>
					<span className="font-mono text-[10px] text-muted-foreground">
						{endLabel ? `${startLabel} → ${endLabel}` : startLabel}
						{durationMs !== null && ` · ${formatRelDuration(durationMs)}`}
					</span>
					{annotation.notes && (
						<span className="text-[10px] text-muted-foreground line-clamp-2">
							{annotation.notes}
						</span>
					)}
					{annotation.created_at && (
						<span className="text-[10px] text-muted-foreground/70">
							added{" "}
							{formatDistanceToNow(new Date(annotation.created_at), {
								addSuffix: true,
							})}
						</span>
					)}
				</div>
			</TooltipContent>
		</TooltipRoot>
	);
}

export function ChartAnnotationOverlay<T extends AnnotationLike>({
	annotations,
	xDomain,
	chartWidth,
	innerWidth,
	innerHeight,
	margin,
	tz,
	tz12,
	onAnnotationClick,
	pending,
}: ChartAnnotationOverlayProps<T>) {
	if (chartWidth <= 0) return null;

	const xRange = xDomain[1] - xDomain[0];
	if (xRange <= 0) return null;

	const toX = (timestamp: string) =>
		margin.left +
		((new Date(timestamp).getTime() - xDomain[0]) / xRange) * innerWidth;

	const inBounds = (x: number) =>
		x >= margin.left && x <= chartWidth - margin.right;

	return (
		// Single TooltipProvider for ALL markers (see TooltipRoot note above).
		// delayDuration={200}: Radix triggers tooltips on `pointermove`; when a
		// new marker mounts under a stationary cursor, delay 0 can race.
		<TooltipProvider delayDuration={200} disableHoverableContent>
			{annotations.map((annotation) => {
				const x = toX(annotation.timestamp_start);
				if (!inBounds(x)) return null;

				const colors = getAnnotationColor(annotation.color);
				const cssColor = annotationRgb(annotation.color);
				const isRegion = !!annotation.timestamp_end;

				// Hit targets are kept narrow so shift+click+drag (brush zoom) on
				// the plot passes through. We also skip our click handler when
				// the shift key is held so even a direct shift-click on the
				// hit target begins a brush instead of opening the annotation.
				const shouldIgnoreClick = (e: React.MouseEvent) => e.shiftKey;
				const handleClick = (e: React.MouseEvent) => {
					if (shouldIgnoreClick(e)) return;
					e.stopPropagation();
					onAnnotationClick(annotation, e.clientX, e.clientY);
				};
				// Stop non-shift mousedown bubbling so clicking a marker while
				// annotation mode is on opens edit instead of racing the chart's
				// create-drag handler; shift-drag brush still starts on a marker.
				const handleMouseDown = (e: React.MouseEvent) => {
					if (!e.shiftKey) e.stopPropagation();
				};

				if (isRegion) {
					const endX = toX(annotation.timestamp_end!);
					const regionLeft = Math.min(x, endX);
					const regionWidth = Math.max(Math.abs(endX - x), 2);

					return (
						<div
							key={annotation.id}
							className="group absolute pointer-events-none z-[25]"
							style={{
								left: regionLeft,
								top: margin.top,
								width: regionWidth,
								height: innerHeight,
							}}
						>
							<div
								className={cn(
									"absolute inset-0 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity",
									colors.dot,
								)}
							/>
							{/* Left edge — clickable hit target */}
							<MarkerTooltip annotation={annotation} tz={tz} tz12={tz12}>
								<button
									type="button"
									aria-label={`Edit annotation ${annotation.label ?? ""}`}
									className="absolute left-0 top-0 bottom-0 w-[3px] p-0 border-0 pointer-events-auto cursor-pointer opacity-25 group-hover:opacity-60 transition-opacity"
									style={{ backgroundColor: cssColor }}
									onClick={handleClick}
									onMouseDown={handleMouseDown}
								/>
							</MarkerTooltip>
							{/* Right edge — clickable hit target */}
							<MarkerTooltip annotation={annotation} tz={tz} tz12={tz12}>
								<button
									type="button"
									aria-label={`Edit annotation ${annotation.label ?? ""}`}
									className="absolute right-0 top-0 bottom-0 w-[3px] p-0 border-0 pointer-events-auto cursor-pointer opacity-25 group-hover:opacity-60 transition-opacity"
									style={{ backgroundColor: cssColor }}
									onClick={handleClick}
									onMouseDown={handleMouseDown}
								/>
							</MarkerTooltip>
							{regionWidth > 48 && annotation.label && (
								<MarkerTooltip annotation={annotation} tz={tz} tz12={tz12}>
									<button
										type="button"
										className="absolute top-1 left-1/2 -translate-x-1/2 flex items-center gap-1 h-[15px] px-1 rounded bg-background/60 border-0 text-[10px] leading-none text-muted-foreground whitespace-nowrap opacity-70 group-hover:opacity-100 transition-opacity pointer-events-auto cursor-pointer"
										style={{ maxWidth: regionWidth - 8 }}
										onClick={handleClick}
										onMouseDown={handleMouseDown}
									>
										<span
											className="h-1 w-1 rounded-full shrink-0"
											style={{ backgroundColor: cssColor }}
										/>
										<span className="truncate">{annotation.label}</span>
									</button>
								</MarkerTooltip>
							)}
						</div>
					);
				}

				// Point annotation — only the top dot captures clicks; the
				// vertical guide line is pass-through so it doesn't create an
				// invisible seam that swallows pointer events.
				return (
					<div
						key={annotation.id}
						className="group absolute pointer-events-none z-[25]"
						style={{ left: x, top: margin.top }}
					>
						{/* Vertical guide line — visual only, never captures events */}
						<div
							className="absolute opacity-[0.18] group-hover:opacity-50 transition-opacity"
							style={{
								height: innerHeight,
								width: 1,
								backgroundColor: cssColor,
							}}
						/>
						{/* Dot at top — hit target */}
						<MarkerTooltip annotation={annotation} tz={tz} tz12={tz12}>
							<button
								type="button"
								aria-label={`Edit annotation ${annotation.label ?? ""}`}
								className="absolute -translate-x-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center p-0 border-0 bg-transparent pointer-events-auto cursor-pointer"
								onClick={handleClick}
								onMouseDown={handleMouseDown}
							>
								<span
									className="block h-1.5 w-1.5 rounded-full ring-2 ring-background"
									style={{ backgroundColor: cssColor }}
								/>
							</button>
						</MarkerTooltip>
					</div>
				);
			})}

			{/* Pending annotation preview */}
			{pending && (() => {
				const isRange = !!pending.timestampEnd;
				if (isRange) {
					const startX = toX(pending.timestampStart);
					const endX = toX(pending.timestampEnd!);
					const left = Math.min(startX, endX);
					const width = Math.max(Math.abs(endX - startX), 2);
					return (
						<div
							className="absolute z-[26] pointer-events-none"
							style={{
								left,
								top: margin.top,
								width,
								height: innerHeight,
							}}
						>
							<div className="absolute inset-0 bg-muted-foreground/5 border-x border-muted-foreground/20" />
							<div
								className="absolute left-0 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse"
							/>
							<div
								className="absolute right-0 translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse"
							/>
						</div>
					);
				}

				// Point preview
				const px = toX(pending.timestampStart);
				if (!inBounds(px)) return null;
				return (
					<div
						className="absolute z-[26] pointer-events-none"
						style={{ left: px, top: margin.top }}
					>
						<div
							className="absolute"
							style={{
								height: innerHeight,
								width: 0,
								borderLeft: "1px dashed",
								borderColor: "var(--muted-foreground)",
								opacity: 0.3,
							}}
						/>
						<div
							className="absolute -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-muted-foreground animate-pulse"
						/>
					</div>
				);
			})()}
		</TooltipProvider>
	);
}
