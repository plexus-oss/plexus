"use client";

import { useMemo } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

export interface PaletteSection {
  id: string;
  label: string;
}

export interface PaletteOption {
  id: string;
  sectionId: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onSelect: () => void;
  keywords?: string[];
  accent?: boolean;
}

interface ResourcePaletteProps {
  query: string;
  setQuery: (v: string) => void;
  sections: PaletteSection[];
  options: PaletteOption[];
  placeholder?: string;
  loading?: boolean;
  footerLeft?: React.ReactNode;
  footerRight?: React.ReactNode;
  onEnter?: (first: PaletteOption | null) => void;
  autoFocus?: boolean;
  className?: string;
}

export function ResourcePalette({
  query,
  setQuery,
  sections,
  options,
  placeholder = "Search...",
  loading = false,
  footerLeft,
  footerRight,
  onEnter,
  autoFocus = true,
  className,
}: ResourcePaletteProps) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay =
        `${o.title} ${o.subtitle} ${(o.keywords ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q) || o.accent;
    });
  }, [options, query]);

  const bySection = useMemo(() => {
    const map = new Map<string, PaletteOption[]>();
    for (const s of sections) map.set(s.id, []);
    for (const o of filtered) {
      const arr = map.get(o.sectionId);
      if (arr) arr.push(o);
    }
    return map;
  }, [filtered, sections]);

  const firstId = filtered[0]?.id;
  const hasFooter = !!(footerLeft || footerRight);

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      {/* Search */}
      <div className="flex items-center gap-3 px-5 h-14 border-b border-border/60 shrink-0">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter?.(filtered[0] ?? null);
              if (!onEnter) filtered[0]?.onSelect();
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground/70 focus:outline-none"
          autoFocus={autoFocus}
        />
        {loading && (
          <Spinner className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">
            No matches for &ldquo;{query}&rdquo;
          </p>
        ) : (
          sections.map((section) => {
            const items = bySection.get(section.id);
            if (!items || items.length === 0) return null;
            return (
              <div key={section.id} className="mb-3 last:mb-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70 px-3 pt-2 pb-1">
                  {section.label}
                </p>
                {items.map((o) => (
                  <button
                    key={o.id}
                    onClick={o.onSelect}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/60",
                      o.id === firstId && "bg-muted/50",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-md shrink-0 [&_svg]:h-4 [&_svg]:w-4",
                        o.accent
                          ? "bg-foreground/5 text-foreground"
                          : "bg-muted/60 text-muted-foreground",
                      )}
                    >
                      {o.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium leading-tight">
                        {o.title}
                      </p>
                      <p className="text-[12px] text-muted-foreground/80 truncate leading-tight mt-0.5">
                        {o.subtitle}
                      </p>
                    </div>
                    <CornerDownLeft
                      className={cn(
                        "h-3 w-3 text-muted-foreground/60 shrink-0 transition-opacity",
                        o.id === firstId
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100",
                      )}
                    />
                  </button>
                ))}
              </div>
            );
          })
        )}
      </div>

      {hasFooter && (
        <div className="flex items-center justify-between gap-4 px-5 h-9 border-t border-border/60 text-[11px] text-muted-foreground shrink-0">
          <div className="flex items-center gap-3">{footerLeft}</div>
          <div className="flex items-center gap-2">{footerRight}</div>
        </div>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border border-border/60 bg-muted/40 font-sans text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}
