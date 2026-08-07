"use client";

/**
 * Shared scope editor — ONE source picker, used by the member scope sheet and
 * the invite dialog. Scope semantics live in lib/access/scope.ts.
 *
 * Sources are the only unit of access: picking a CONNECTION grants all its
 * rows; picking ENTITY sources (minted by discovery, e.g. sat-25544) grants
 * just their rows — the server row-filters connection queries from the
 * discovery associations automatically. No raw IDs anywhere.
 */

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useSourcesSwr } from "@/hooks/use-sources-swr";
import { Globe, Lock, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScopeDraft {
  restricted: boolean;
  selected: Set<string>;
}

/** Seed a draft from the stored array (null = no scope / full access). */
export function scopeDraftFrom(sourceIds: string[] | null): ScopeDraft {
  return {
    restricted: sourceIds !== null,
    selected: new Set(sourceIds ?? []),
  };
}

/** Draft → the array the API stores (null = no scope). */
export function scopePayload(draft: ScopeDraft): {
  sourceIds: string[] | null;
} {
  return {
    sourceIds: draft.restricted ? [...draft.selected] : null,
  };
}

/** Order-insensitive dirty check against the stored array. */
export function scopeDirty(
  draft: ScopeDraft,
  sourceIds: string[] | null,
): boolean {
  const next = scopePayload(draft);
  if (next.sourceIds === null || sourceIds === null) {
    return next.sourceIds !== sourceIds;
  }
  if (next.sourceIds.length !== sourceIds.length) return true;
  const set = new Set(sourceIds);
  return !next.sourceIds.every((v) => set.has(v));
}

interface Props {
  draft: ScopeDraft;
  onChange: (draft: ScopeDraft) => void;
  /** Copy for the unrestricted option, e.g. "Full access". */
  fullLabel: string;
  fullHint: string;
  /** e.g. "member sees nothing". */
  emptySelectionNote: string;
  /** Class for the list container (sizing differs per host layout). */
  listClassName?: string;
}

export function ScopeEditor({
  draft,
  onChange,
  fullLabel,
  fullHint,
  emptySelectionNote,
  listClassName,
}: Props) {
  const { sources, isLoading } = useSourcesSwr();
  const [search, setSearch] = useState("");

  // Group: Connections first (whole-DB grants), then devices & entities.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (sources ?? []).filter(
      (s) =>
        !q ||
        s.slug.toLowerCase().includes(q) ||
        (s.name ?? "").toLowerCase().includes(q),
    );
    return [
      {
        label: "Connections",
        hint: "grants every row",
        items: list.filter((s) => s.source_type === "connection"),
      },
      {
        label: "Devices & entities",
        hint: "grants just that source's data",
        items: list.filter((s) => s.source_type !== "connection"),
      },
    ].filter((g) => g.items.length > 0);
  }, [sources, search]);

  const set = (patch: Partial<ScopeDraft>) => onChange({ ...draft, ...patch });

  const toggle = (id: string) => {
    const next = new Set(draft.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selected: next });
  };

  return (
    <>
      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => set({ restricted: false })}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
            !draft.restricted
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted/50"
          }`}
        >
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <div className="font-medium">{fullLabel}</div>
            <div className="text-[11px] text-muted-foreground">{fullHint}</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => set({ restricted: true })}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
            draft.restricted
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted/50"
          }`}
        >
          <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <div className="font-medium">Restricted</div>
            <div className="text-[11px] text-muted-foreground">
              Only selected
            </div>
          </div>
        </button>
      </div>

      {/* Source list (only when restricted) */}
      {draft.restricted && (
        <div className="flex min-h-0 flex-1 flex-col pt-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sources"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {draft.selected.size} selected
              {draft.selected.size === 0 && ` — ${emptySelectionNote}`}
            </span>
            {draft.selected.size > 0 && (
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => set({ selected: new Set() })}
              >
                Clear
              </button>
            )}
          </div>

          <div
            className={cn(
              "mt-2 min-h-0 flex-1 overflow-y-auto rounded-md border border-border",
              listClassName,
            )}
          >
            {isLoading ? (
              <div className="flex h-full items-center justify-center py-8">
                <Spinner />
              </div>
            ) : groups.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No sources found
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.label}>
                  <div className="flex items-baseline gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-1">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {g.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {g.hint}
                    </span>
                  </div>
                  <div className="divide-y divide-border/60">
                    {g.items.map((s) => (
                      <label
                        key={s.id}
                        className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={draft.selected.has(s.id)}
                          onCheckedChange={() => toggle(s.id)}
                          className="h-3.5 w-3.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">
                            {s.name || s.slug}
                          </div>
                          {s.name && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {s.slug}
                            </div>
                          )}
                        </div>
                        {s.device_type && (
                          <Badge variant="secondary" className="text-[10px]">
                            {s.device_type}
                          </Badge>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
