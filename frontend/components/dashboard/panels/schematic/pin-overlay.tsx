"use client";

/**
 * Pin overlay — renders an AnchorCap + Connector + Callout per binding,
 * with inline edit affordances when editing.
 *
 * Layout discipline:
 *   - Connector lines and anchor caps are drawn in a single SVG that
 *     shares the schematic's viewBox. They live in the same coordinate
 *     space as the underlying schematic.
 *   - Chip callouts are DOM elements positioned at the schematic-relative
 *     percent of (anchor + offset_in_viewBox). They live inside the
 *     TransformComponent so they pan/zoom with the schematic, but their
 *     chrome counter-scales so the typography stays legible at any zoom.
 *   - Both rely on a *base* vbPerPx (viewBox-per-pixel at zoom=1), pulled
 *     from the panel's outer container size. Using the zoom-aware
 *     getBoundingClientRect of the inlined SVG would make connector
 *     endpoints drift relative to chip positions on zoom — bug we had
 *     in the prior implementation.
 *
 * Edit mode:
 *   - Clicking a chip opens an inline Radix Popover at the chip with
 *     metric / display / label / threshold / delete controls.
 *   - Dragging a chip past a small threshold updates `calloutOffset`,
 *     so users tune layout in the canvas instead of the sidebar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { TelemetryBinding } from "@/lib/types/dashboard";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  resolveAnchor,
  type ResolvedPoint,
} from "@/lib/schematic/anchor-resolver";
import {
  SCHEMATIC_THEME,
  thresholdFor,
  type ThresholdState,
} from "@/lib/schematic/theme";
import { Callout, type CalloutExtras } from "./callout";
import { Connector, AnchorCap } from "./connector";
import { useSchematicContext } from "./schematic-canvas";

interface PinOverlayProps {
  bindings: TelemetryBinding[];
  values: Record<string, number | string | null>;
  /** Linear-style meta info per metric — delta, lastUpdatedAt. */
  extras?: Record<string, CalloutExtras>;
  units?: Record<string, string>;
  showConnectors?: boolean;
  editMode?: boolean;
  /** Pull live metric list to power the inline edit popover's metric picker. */
  availableMetrics?: string[];
  /** Patch a binding by id (called from the inline editor). */
  onBindingChange?: (id: string, updates: Partial<TelemetryBinding>) => void;
  /** Remove a binding by id. */
  onBindingDelete?: (id: string) => void;
}

const DRAG_THRESHOLD_PX = 3;

export function PinOverlay({
  bindings,
  values,
  extras,
  units,
  showConnectors = true,
  editMode = false,
  availableMetrics = [],
  onBindingChange,
  onBindingDelete,
}: PinOverlayProps) {
  const { svgRef, scale, viewBox, basePanelWidth } = useSchematicContext();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    startOffset: { dx: number; dy: number };
    moved: boolean;
  } | null>(null);
  // Tracks the listeners registered for the active drag so onDragEnd can
  // tear them down without referencing the handler functions themselves.
  const dragAbortRef = useRef<AbortController | null>(null);

  // Resolve every binding's anchor to a viewBox-space point. Re-runs
  // when the SVG DOM swaps (e.g. after a new upload) or bindings move.
  const resolved = useMemo(() => {
    if (!viewBox) return [] as Array<{ binding: TelemetryBinding; point: ResolvedPoint }>;
    const out: Array<{ binding: TelemetryBinding; point: ResolvedPoint }> = [];
    for (const b of bindings) {
      const point = resolveAnchor(svgRef, b.anchor);
      if (!point) continue;
      out.push({ binding: b, point });
    }
    return out;
  }, [bindings, svgRef, viewBox]);

  // viewBox units per CSS px at base zoom (1x). Doesn't change with zoom
  // because basePanelWidth comes from the un-transformed outer container.
  const vbPerPx = useMemo(() => {
    if (!viewBox || !basePanelWidth) return 1;
    return viewBox.width / basePanelWidth;
  }, [viewBox, basePanelWidth]);

  const onDragMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || !onBindingChange) return;
    const ddx = e.clientX - d.startX;
    const ddy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(ddx, ddy) > DRAG_THRESHOLD_PX) {
      d.moved = true;
    }
    if (!d.moved) return;
    // The pointer delta is in screen px; convert to "base px" by
    // dividing by the current visual scale, so dragging while zoomed
    // moves the chip by what the pointer says it moves by on screen.
    const ddxBase = ddx / Math.max(0.001, scale);
    const ddyBase = ddy / Math.max(0.001, scale);
    onBindingChange(d.id, {
      calloutOffset: {
        dx: d.startOffset.dx + ddxBase,
        dy: d.startOffset.dy + ddyBase,
      },
    });
  }, [onBindingChange, scale]);

  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    dragAbortRef.current?.abort();
    dragAbortRef.current = null;
  }, []);

  useEffect(() => () => onDragEnd(), [onDragEnd]);

  const startDrag = (binding: TelemetryBinding, e: React.PointerEvent) => {
    if (!editMode || !onBindingChange) return;
    e.stopPropagation();
    e.preventDefault();
    const offset = binding.calloutOffset ?? SCHEMATIC_THEME.callout.defaultOffset;
    dragRef.current = {
      id: binding.id,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: { dx: offset.dx, dy: offset.dy },
      moved: false,
    };
    const controller = new AbortController();
    dragAbortRef.current = controller;
    window.addEventListener("pointermove", onDragMove, {
      signal: controller.signal,
    });
    window.addEventListener("pointerup", onDragEnd, {
      signal: controller.signal,
    });
  };

  const onChipClick = (binding: TelemetryBinding) => {
    if (!editMode) return;
    // If the user just dragged, suppress the click — pointerup won't
    // have set moved=false yet because we clear dragRef in onDragEnd.
    if (dragRef.current?.moved) return;
    setSelectedId((id) => (id === binding.id ? null : binding.id));
  };

  if (!viewBox || resolved.length === 0) return null;

  return (
    <>
      {/* ── Connector lines + anchor caps (viewBox space) ────────── */}
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "100%" }}
      >
        {resolved.map(({ binding, point }) => {
          const offset = binding.calloutOffset ?? SCHEMATIC_THEME.callout.defaultOffset;
          const dxVb = offset.dx * vbPerPx;
          const dyVb = offset.dy * vbPerPx;
          const v = values[binding.metric];
          const state: ThresholdState =
            typeof v === "number"
              ? thresholdFor(v, binding.thresholdWarning, binding.thresholdCritical)
              : "normal";
          const hovered = hoveredId === binding.id;
          return (
            <g key={binding.id}>
              {showConnectors && (
                <Connector
                  fromX={point.x}
                  fromY={point.y}
                  toX={point.x + dxVb}
                  toY={point.y + dyVb}
                  state={state}
                  hovered={hovered}
                />
              )}
              <AnchorCap
                x={point.x}
                y={point.y}
                state={state}
                pulse={state === "critical"}
              />
            </g>
          );
        })}
      </svg>

      {/* ── Chip layer (DOM, positioned at percent of viewBox) ──────
            Anchor + offset BOTH live in viewBox space, so the chip
            stays glued to its target point at every zoom level — same
            coord system as the connector. Only the chrome content is
            counter-scaled to stay legible. */}
      <div className="absolute inset-0 pointer-events-none">
        {resolved.map(({ binding, point }) => {
          const offset = binding.calloutOffset ?? SCHEMATIC_THEME.callout.defaultOffset;
          const dxVb = offset.dx * vbPerPx;
          const dyVb = offset.dy * vbPerPx;
          // Chip target in viewBox coords, expressed as % of viewBox so
          // it inherits the schematic's render box correctly.
          const leftPct = ((point.x + dxVb - viewBox.x) / viewBox.width) * 100;
          const topPct = ((point.y + dyVb - viewBox.y) / viewBox.height) * 100;
          const selected = selectedId === binding.id;
          const v = values[binding.metric];

          return (
            <div
              key={binding.id}
              className="absolute"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
              }}
            >
              <Popover
                open={editMode && selected}
                onOpenChange={(o) => {
                  if (!o) setSelectedId(null);
                }}
              >
                <PopoverAnchor asChild>
                  <div
                    className="absolute"
                    style={{
                      // Counter-scale only the chrome so the chip stays
                      // a constant visual size at any zoom.
                      transform: `translate(-50%, -50%) scale(${1 / Math.max(0.001, scale)})`,
                      transformOrigin: "center",
                    }}
                  >
                    <div
                      role={editMode ? "button" : undefined}
                      tabIndex={editMode ? 0 : undefined}
                      className={
                        "pointer-events-auto " +
                        (editMode ? "cursor-grab active:cursor-grabbing" : "cursor-default")
                      }
                      onPointerDown={(e) => startDrag(binding, e)}
                      onClick={() => onChipClick(binding)}
                      onMouseEnter={() => setHoveredId(binding.id)}
                      onMouseLeave={() => setHoveredId((id) => (id === binding.id ? null : id))}
                    >
                      <Callout
                        binding={binding}
                        value={v ?? null}
                        defaultUnit={units?.[binding.metric]}
                        selected={selected}
                        extras={extras?.[binding.metric]}
                      />
                    </div>
                  </div>
                </PopoverAnchor>
                {editMode && selected && onBindingChange && (
                  <PopoverContent
                    side="bottom"
                    align="start"
                    sideOffset={8}
                    className="w-64 p-0"
                    onWheel={(e) => e.stopPropagation()}
                  >
                    <BindingInlineEditor
                      binding={binding}
                      metrics={availableMetrics}
                      onChange={(updates) => onBindingChange(binding.id, updates)}
                      onDelete={() => {
                        onBindingDelete?.(binding.id);
                        setSelectedId(null);
                      }}
                    />
                  </PopoverContent>
                )}
              </Popover>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Inline editor (Radix Popover content) ────────────────────────────
function BindingInlineEditor({
  binding,
  metrics,
  onChange,
  onDelete,
}: {
  binding: TelemetryBinding;
  metrics: string[];
  onChange: (updates: Partial<TelemetryBinding>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-2 p-2.5">
      <div className="flex items-center justify-between">
        <Label className="text-[9px] uppercase tracking-wide text-muted-foreground">
          Pin
        </Label>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div>
        <Label className="text-[9px] text-muted-foreground">Metric</Label>
        <Select
          value={binding.metric || "_none"}
          onValueChange={(v) => onChange({ metric: v === "_none" ? "" : v })}
        >
          <SelectTrigger className="h-7 text-[11px] mt-0.5">
            <SelectValue placeholder="No metric" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none" className="text-xs">
              No metric
            </SelectItem>
            {metrics.map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {m.includes(":") ? m.split(":")[1] : m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-1.5">
        <div className="flex-1">
          <Label className="text-[9px] text-muted-foreground">Show</Label>
          <Select
            value={binding.display}
            onValueChange={(v) =>
              onChange({ display: v as TelemetryBinding["display"] })
            }
          >
            <SelectTrigger className="h-7 text-[11px] mt-0.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="value" className="text-xs">
                Value
              </SelectItem>
              <SelectItem value="state" className="text-xs">
                State
              </SelectItem>
              <SelectItem value="indicator" className="text-xs">
                Indicator
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Label className="text-[9px] text-muted-foreground">Label</Label>
          <Input
            value={binding.label ?? ""}
            onChange={(e) =>
              onChange({ label: e.target.value || undefined })
            }
            className="h-7 text-[11px] mt-0.5"
            placeholder="Auto"
          />
        </div>
      </div>

      <div className="flex gap-1.5">
        <div className="flex-1">
          <Label className="text-[9px] text-muted-foreground">Warn ≥</Label>
          <Input
            type="number"
            value={binding.thresholdWarning ?? ""}
            onChange={(e) =>
              onChange({
                thresholdWarning: e.target.value
                  ? parseFloat(e.target.value)
                  : undefined,
              })
            }
            className="h-7 text-[11px] mt-0.5"
            placeholder="—"
          />
        </div>
        <div className="flex-1">
          <Label className="text-[9px] text-muted-foreground">Crit ≥</Label>
          <Input
            type="number"
            value={binding.thresholdCritical ?? ""}
            onChange={(e) =>
              onChange({
                thresholdCritical: e.target.value
                  ? parseFloat(e.target.value)
                  : undefined,
              })
            }
            className="h-7 text-[11px] mt-0.5"
            placeholder="—"
          />
        </div>
      </div>

      <p className="text-[9px] text-muted-foreground pt-1 border-t border-border/40">
        Drag the chip to reposition.
      </p>
    </div>
  );
}
