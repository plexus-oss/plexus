import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";

export type SparklineTrend = "up" | "down" | "flat";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  trend?: SparklineTrend;
  className?: string;
}

function detectTrend(data: number[]): SparklineTrend {
  if (data.length < 2) return "flat";
  const first = data.slice(0, Math.ceil(data.length / 3));
  const last = data.slice(-Math.ceil(data.length / 3));
  const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
  const avgLast = last.reduce((a, b) => a + b, 0) / last.length;
  const diff = avgLast - avgFirst;
  const range = Math.max(...data) - Math.min(...data);
  if (range === 0) return "flat";
  const ratio = diff / range;
  if (ratio > 0.1) return "up";
  if (ratio < -0.1) return "down";
  return "flat";
}

const trendColors: Record<SparklineTrend, string> = {
  up: "hsl(142, 71%, 45%)",
  down: "hsl(0, 84%, 60%)",
  flat: "hsl(215, 20%, 65%)",
};

export function Sparkline({
  data,
  width = 60,
  height = 20,
  color,
  trend: trendProp,
  className,
}: SparklineProps) {
  const gradientId = useId();
  const { points, fillPoints, resolvedColor } = useMemo(() => {
    if (data.length < 2)
      return { points: "", fillPoints: "", resolvedColor: "" };

    const resolvedTrend = trendProp ?? detectTrend(data);
    const resolvedColor = color ?? trendColors[resolvedTrend];

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 1;

    const coords = data.map((value, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = padding + (1 - (value - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    const points = coords.join(" ");
    const fillPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;

    return { points, fillPoints, resolvedColor };
  }, [data, width, height, color, trendProp]);

  if (data.length < 2) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("inline-block", className)}
      fill="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={resolvedColor} stopOpacity={0.3} />
          <stop offset="100%" stopColor={resolvedColor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill={`url(#${gradientId})`} />
      <polyline
        points={points}
        stroke={resolvedColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
