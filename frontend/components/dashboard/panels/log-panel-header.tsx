"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * LogPanelHeader — the shared header strip for every log / event / alert panel.
 *
 * Left: an optional `leading` slot (e.g. a live dot) then a borderless filter
 * input. Right: a filtered/total count, then an optional `trailing` slot (e.g.
 * a "View all" link). Keeping one header means all four panels filter and count
 * identically.
 */

export interface LogPanelHeaderProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** Hide the filter input (keeps the count + slots). */
  hideSearch?: boolean;
  /** Items currently shown. */
  count: number;
  /** Total before filtering — rendered as "/total" when it differs from count. */
  total?: number;
  /** Rendered before the filter input (e.g. a live status dot). */
  leading?: ReactNode;
  /** Rendered after the count (e.g. a jump-to-page link). */
  trailing?: ReactNode;
  placeholder?: string;
}

export function LogPanelHeader({
  search,
  onSearchChange,
  hideSearch,
  count,
  total,
  leading,
  trailing,
  placeholder = "Filter…",
}: LogPanelHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 shrink-0">
      {leading}
      {hideSearch ? (
        <div className="flex-1" />
      ) : (
        <div className="relative flex-1">
          <Search className="absolute left-0 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
          <Input
            placeholder={placeholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-6 pl-4 pr-2 text-[11px] bg-transparent border-0 shadow-none rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
          />
        </div>
      )}
      <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
        {count}
        {total !== undefined && total !== count && (
          <span className="text-muted-foreground/50">/{total}</span>
        )}
      </span>
      {trailing}
    </div>
  );
}
