"use client";

import type { CSSProperties, ReactNode } from "react";
import { format } from "date-fns";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeShort } from "@/lib/format/relative-time";

/**
 * LogRow — the single compact feed row shared by every log / event / alert
 * panel (Logs, Device Events, Activity, Alerts). One row primitive keeps the
 * Linear/Vercel rhythm identical across all four: a 1.5px leading dot, a
 * primary label, optional muted secondary text, inline monospace chips, a
 * right-aligned relative timestamp, and an optional jump arrow.
 *
 * It is presentational only. Virtualized panels (Logs, Device Events) position
 * each row absolutely by passing `style`; flow-layout panels (Activity, Alerts)
 * pass nothing and let rows stack.
 */

export interface LogRowChip {
  /** Left half of the chip. When `value` is omitted, rendered as a plain tag. */
  key: string;
  /** Right half, emphasized slightly. */
  value?: string;
}

export interface LogRowProps {
  /**
   * Tailwind bg class for the leading dot (e.g. "bg-red-500"). Pass `null` to
   * hide the dot entirely; omit to get the neutral default dot.
   */
  dotClassName?: string | null;
  /** Pulse the dot (active / open states). */
  pulse?: boolean;
  /** Primary label. */
  title: string;
  /** Render the title monospace + slightly smaller (event names, log keys). */
  titleMono?: boolean;
  /** Muted secondary text shown after the title. */
  description?: string;
  /** Inline monospace chips (tags, value/threshold, source). Capped at 3. */
  chips?: LogRowChip[];
  /** Content rendered just before the timestamp (e.g. a status word). */
  trailing?: ReactNode;
  /** Timestamp — rendered relative ("5m") unless `absoluteTime` is set. */
  timestamp?: string | Date | null;
  /** Render the timestamp as an absolute "MMM d, HH:mm" instead of relative. */
  absoluteTime?: boolean;
  /** Opens in a new tab on click and shows a jump arrow. */
  href?: string;
  /** Custom click handler (takes precedence over `href` navigation). */
  onClick?: () => void;
  /** Outer style — used by virtualized parents for absolute positioning. */
  style?: CSSProperties;
  className?: string;
  /** Native title attribute (full text on hover). */
  hoverTitle?: string;
}

const ROW_BASE =
  "group flex items-center gap-2.5 px-3 hover:bg-muted/40 transition-colors";

export function LogRow({
  dotClassName,
  pulse,
  title,
  titleMono,
  description,
  chips,
  trailing,
  timestamp,
  absoluteTime,
  href,
  onClick,
  style,
  className,
  hoverTitle,
}: LogRowProps) {
  const interactive = Boolean(href || onClick);
  const ts = timestamp != null ? new Date(timestamp) : null;
  const showDot = dotClassName !== null;

  const handleClick = () => {
    if (onClick) onClick();
    else if (href) window.open(href, "_blank");
  };

  return (
    <div
      className={cn(ROW_BASE, interactive && "cursor-pointer", className)}
      style={style}
      onClick={interactive ? handleClick : undefined}
      title={hoverTitle}
    >
      {showDot && (
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0 ring-[3px] ring-background relative z-[1]",
            dotClassName || "bg-muted-foreground/30",
            pulse && "animate-pulse",
          )}
        />
      )}

      <span
        className={cn(
          "text-foreground shrink min-w-0 truncate",
          titleMono ? "font-mono text-[11px]" : "text-[12px]",
        )}
      >
        {title}
      </span>

      {description && (
        <span className="text-[11px] text-muted-foreground truncate shrink min-w-0">
          {description}
        </span>
      )}

      {chips?.slice(0, 3).map((c) => (
        <span
          key={c.key + (c.value ?? "")}
          className="text-[10px] font-mono text-muted-foreground/60 tabular-nums shrink-0 hidden md:inline"
        >
          {c.value !== undefined ? (
            <>
              {c.key}=
              <span className="text-muted-foreground/80">{c.value}</span>
            </>
          ) : (
            c.key
          )}
        </span>
      ))}

      {/* Push the trailing cluster (status / timestamp / arrow) to the right. */}
      <div className="flex-1 min-w-0" />

      {trailing}

      {ts && (
        <span
          title={format(ts, "yyyy-MM-dd HH:mm:ss")}
          className="text-[10px] font-mono text-muted-foreground/70 tabular-nums shrink-0"
        >
          {absoluteTime ? format(ts, "MMM d, HH:mm") : formatRelativeShort(ts)}
        </span>
      )}

      {href && (
        <ArrowUpRight className="h-3 w-3 text-muted-foreground/50 group-hover:text-foreground shrink-0 transition-colors" />
      )}
    </div>
  );
}
