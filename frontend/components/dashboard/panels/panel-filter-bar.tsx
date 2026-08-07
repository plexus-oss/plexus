"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface PanelFilterBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Count shown on the right (e.g. filtered rows). */
  count?: number;
  /** Total count; when provided and differs from `count`, renders "count / total". */
  total?: number;
  /** Optional slot rendered to the right of the count (e.g. actions). */
  trailing?: React.ReactNode;
}

export function PanelFilterBar({
  value,
  onChange,
  placeholder = "Filter",
  count,
  total,
  trailing,
}: PanelFilterBarProps) {
  const showRatio = total !== undefined && count !== undefined && count !== total;
  return (
    <div className="shrink-0 flex items-center gap-1.5 px-2.5 h-9 border-b border-border/40">
      <div className="flex-1 flex items-center gap-1.5 h-6 px-2 rounded-md bg-muted/40 focus-within:bg-muted/60 focus-within:ring-1 focus-within:ring-border transition-colors">
        <Search
          className="h-3 w-3 text-muted-foreground/50 shrink-0"
          strokeWidth={2.25}
        />
        <Input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 h-full px-0 py-0 text-[12px] leading-none bg-transparent border-0 rounded-none shadow-none outline-none focus:ring-0 focus-visible:ring-0 placeholder:text-muted-foreground/40 tracking-tight"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear filter"
            className="h-4 w-4 flex items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-3 w-3" strokeWidth={2.25} />
          </button>
        )}
      </div>
      {(count !== undefined || trailing) && (
        <div className="flex items-center gap-1 pl-1 text-[11px] tabular-nums text-muted-foreground/70">
          {count !== undefined && showRatio ? (
            <>
              <span className="text-foreground/90 font-medium">{count}</span>
              <span className="text-muted-foreground/40">/</span>
              <span>{total}</span>
            </>
          ) : count !== undefined ? (
            <span className="text-foreground/80 font-medium">{count}</span>
          ) : null}
          {trailing}
        </div>
      )}
    </div>
  );
}
