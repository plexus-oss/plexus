"use client";

import { measureTextWidth, useBaseChart } from "./base-chart";

export interface ReferenceLine {
  /** Y value where the line should be drawn */
  value: number;
  /** Line color */
  color?: string;
  /** Line style */
  style?: "solid" | "dashed" | "dotted";
  /** Line width */
  width?: number;
  /** Optional label to show on the line */
  label?: string;
  /** Label position */
  labelPosition?: "left" | "right";
  /** Severity for styling (critical = red, warning = yellow, info = blue) */
  severity?: "critical" | "warning" | "info";
  /** Makes the label pill clickable (e.g. navigate to the monitor behind a limit) */
  onClick?: () => void;
}

const LABEL_FONT = "500 11px -apple-system, BlinkMacSystemFont, sans-serif";

interface ReferenceLineProps {
  lines: ReferenceLine[];
}

const SEVERITY_COLORS = {
  critical: "#ef4444", // red-500
  warning: "#f59e0b", // amber-500
  info: "#3b82f6", // blue-500
};

const DASH_PATTERNS = {
  solid: "none",
  dashed: "8,4",
  dotted: "2,4",
};

export function ReferenceLines({ lines }: ReferenceLineProps) {
  const ctx = useBaseChart();

  if (!lines || lines.length === 0) return null;

  const innerHeight = ctx.height - ctx.margin.top - ctx.margin.bottom;

  // Calculate y position from value
  const getYPosition = (value: number) => {
    const [yMin, yMax] = ctx.yDomain;
    const normalized = (value - yMin) / (yMax - yMin);
    // Invert because SVG y-axis goes down
    return ctx.margin.top + innerHeight * (1 - normalized);
  };

  const chartTop = ctx.margin.top;
  const chartBottom = ctx.height - ctx.margin.bottom;

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-10"
      style={{ width: ctx.width, height: ctx.height }}
    >
      {lines.map((line, idx) => {
        const rawY = getYPosition(line.value);

        // Clamp y position to chart area, but still show line at edge if outside
        const isAboveChart = rawY < chartTop;
        const isBelowChart = rawY > chartBottom;
        const y = Math.max(chartTop, Math.min(chartBottom, rawY));

        // Determine if line is visible (within or near the chart area)
        const isOutside = isAboveChart || isBelowChart;

        const color = line.severity
          ? SEVERITY_COLORS[line.severity]
          : line.color || "#888888";
        const strokeWidth = line.width || 1.5;
        const dashArray = DASH_PATTERNS[line.style || "dashed"];
        const labelPos = line.labelPosition || "right";

        return (
          <g key={idx}>
            {/* The reference line - show at edge if outside visible area */}
            <line
              x1={ctx.margin.left}
              y1={y}
              x2={ctx.width - ctx.margin.right}
              y2={y}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={dashArray}
              opacity={isOutside ? 0.4 : 0.8}
            />

            {/* Optional label — pill sits inside the plot area so it never clips */}
            {line.label &&
              (() => {
                const labelText =
                  line.label + (isOutside ? (isAboveChart ? " ↑" : " ↓") : "");
                const pillWidth =
                  Math.ceil(measureTextWidth([labelText], LABEL_FONT)) + 12;
                const pillX =
                  labelPos === "right"
                    ? ctx.width - ctx.margin.right - 6 - pillWidth
                    : ctx.margin.left + 6;
                return (
                  <g
                    onClick={line.onClick}
                    // Stop mousedown bubbling so the chart's pan/zoom handler
                    // doesn't treat a pill click as the start of a drag.
                    onMouseDown={
                      line.onClick ? (e) => e.stopPropagation() : undefined
                    }
                    style={
                      line.onClick
                        ? { pointerEvents: "auto", cursor: "pointer" }
                        : undefined
                    }
                  >
                    {line.onClick && <title>View monitor</title>}
                    <rect
                      x={pillX}
                      y={y - 8}
                      width={pillWidth}
                      height={16}
                      rx={3}
                      fill={color}
                      opacity={isOutside ? 0.6 : 0.9}
                    />
                    <text
                      x={pillX + 6}
                      y={y + 4}
                      fontSize={11}
                      fontWeight={500}
                      fill="white"
                      textAnchor="start"
                    >
                      {labelText}
                    </text>
                  </g>
                );
              })()}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Helper to convert column limits to reference lines
 */
export function limitsToReferenceLines(limits: {
  min?: number;
  max?: number;
  severity?: "critical" | "warning" | "info";
}): ReferenceLine[] {
  const lines: ReferenceLine[] = [];

  if (limits.min !== undefined) {
    lines.push({
      value: limits.min,
      severity: limits.severity || "warning",
      style: "dashed",
      label: `Min: ${limits.min}`,
      labelPosition: "right",
    });
  }

  if (limits.max !== undefined) {
    lines.push({
      value: limits.max,
      severity: limits.severity || "warning",
      style: "dashed",
      label: `Max: ${limits.max}`,
      labelPosition: "right",
    });
  }

  return lines;
}
