"use client";

/**
 * Hairline connector — 1px line from a pin's anchor (in the schematic) to
 * its callout (offset into negative space).
 *
 * Solid in the normal case. Dashed only when the chip is unusually far
 * from the anchor. Threshold state colors the stroke. Hover boosts the
 * opacity so the connector "lights up" when the user mouses the chip.
 */

import { SCHEMATIC_THEME, type ThresholdState } from "@/lib/schematic/theme";

interface ConnectorProps {
  /** Anchor end (viewBox coords). */
  fromX: number;
  fromY: number;
  /** Callout end (viewBox coords). */
  toX: number;
  toY: number;
  state: ThresholdState;
  hovered?: boolean;
}

export function Connector({
  fromX,
  fromY,
  toX,
  toY,
  state,
  hovered,
}: ConnectorProps) {
  const dist = Math.hypot(toX - fromX, toY - fromY);
  const isDashed = dist > SCHEMATIC_THEME.callout.connectorSolidMax;
  const colors = SCHEMATIC_THEME.threshold[state];
  const opacity = Math.min(
    1,
    SCHEMATIC_THEME.connector.opacity +
      (hovered ? SCHEMATIC_THEME.connector.hoverBoost : 0) +
      (state === "normal" ? 0 : 0.25),
  );

  return (
    <line
      x1={fromX}
      y1={fromY}
      x2={toX}
      y2={toY}
      stroke={colors.stroke}
      strokeWidth={SCHEMATIC_THEME.connector.width}
      strokeDasharray={
        isDashed ? SCHEMATIC_THEME.connector.dashArray : undefined
      }
      opacity={opacity}
      vectorEffect="non-scaling-stroke"
      strokeLinecap="round"
    />
  );
}

/**
 * Tiny terminus at the connector's *anchor* end. In normal state it's a
 * single small filled circle — no outer ring — matching the Revel
 * reference. Warn/critical get an outer ring so the eye finds them.
 */
export function AnchorCap({
  x,
  y,
  state,
  pulse,
}: {
  x: number;
  y: number;
  state: ThresholdState;
  /** Soft 1.4s pulse — typically only on critical. */
  pulse?: boolean;
}) {
  const colors = SCHEMATIC_THEME.threshold[state];
  const showOuter = state !== "normal";
  return (
    <g
      style={{
        animation: pulse
          ? `pulse ${SCHEMATIC_THEME.motion.pulseMs}ms ease-in-out infinite`
          : undefined,
      }}
    >
      {showOuter && (
        <circle
          cx={x}
          cy={y}
          r={SCHEMATIC_THEME.cap.radius + SCHEMATIC_THEME.cap.outlineWidth + 0.5}
          fill="none"
          stroke={colors.stroke}
          strokeWidth={SCHEMATIC_THEME.cap.outlineWidth}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle
        cx={x}
        cy={y}
        r={SCHEMATIC_THEME.cap.radius}
        fill={colors.cap}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}
