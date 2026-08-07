"use client";

/**
 * Identity mapping — the third home of identity declaration.
 *
 * "Which column names the things you're monitoring?" Table → column → kind,
 * with a live preview ("Found 40 distinct values"), then Save posts a
 * discovery rule; the background loop keeps the minted entities synced.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { detectTimeColumn, isKeyName } from "@/lib/dashboard/column-roles";
import { SOURCE_KINDS } from "@/lib/sources/kinds";
import { toast } from "@/lib/toast-utils";

interface PreviewResult {
  count: number;
  truncated: boolean;
  sample: Array<{ value: string; slug: string }>;
}

// Structural minimum — the app has two SchemaInfo shapes (use-sources vs
// use-connection-schema); both satisfy this.
export interface MappingSchema {
  tables: Array<{
    name: string;
    schema?: string;
    columns: Array<{ name: string; type: string }>;
  }>;
}

interface IdentityMappingProps {
  /** Connection source id (uuid or slug — the API resolves both). */
  sourceId: string;
  schema: MappingSchema | null;
  /** Called after a rule is saved (e.g. refresh, close). */
  onSaved?: (discovered: number) => void;
  /** Compact style for the add-connection dialog. */
  compact?: boolean;
}

export function IdentityMapping({
  sourceId,
  schema,
  onSaved,
}: IdentityMappingProps) {
  const [tableKey, setTableKey] = useState<string>("");
  const [idColumn, setIdColumn] = useState<string>("");
  const [kind, setKind] = useState<string>("device");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const tables = useMemo(() => schema?.tables ?? [], [schema]);
  const table = useMemo(
    () =>
      tables.find(
        (t) => (t.schema ? `${t.schema}.${t.name}` : t.name) === tableKey,
      ),
    [tables, tableKey],
  );

  // Likely identity columns first (…_id, name-ish keys), never the time column.
  const columnOptions = useMemo(() => {
    if (!table) return [];
    const timeCol = detectTimeColumn(table.columns);
    return [...table.columns]
      .filter((c) => c.name !== timeCol)
      .sort((a, b) => Number(isKeyName(b.name)) - Number(isKeyName(a.name)));
  }, [table]);

  // Render-phase "adjust state on prop change" (house pattern — see
  // add-panel-modal): resetting in an effect would cascade renders.
  const [prevTableKey, setPrevTableKey] = useState(tableKey);
  if (tableKey !== prevTableKey) {
    setPrevTableKey(tableKey);
    setIdColumn("");
    setPreview(null);
  }

  useEffect(() => {
    if (!table || !idColumn) return;
    const controller = new AbortController();
    const run = async () => {
      setPreviewing(true);
      try {
        const params = new URLSearchParams({
          table: table.name,
          column: idColumn,
        });
        if (table.schema) params.set("schema", table.schema);
        const res = await fetch(
          `/api/sources/${sourceId}/discovery/preview?${params}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error((await res.json()).error ?? "preview failed");
        setPreview(await res.json());
      } catch (err) {
        if (!controller.signal.aborted) {
          setPreview(null);
          console.error("[identity-mapping] preview failed:", err);
        }
      } finally {
        if (!controller.signal.aborted) setPreviewing(false);
      }
    };
    void run();
    return () => controller.abort();
  }, [sourceId, table, idColumn]);

  const handleSave = async () => {
    if (!table || !idColumn) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sources/${sourceId}/discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: table.name,
          ...(table.schema ? { schema: table.schema } : {}),
          idColumn,
          ...(detectTimeColumn(table.columns)
            ? { timeColumn: detectTimeColumn(table.columns) }
            : {}),
          kind,
          enabled: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "save failed");
      toast.success(
        body.discovered > 0
          ? `Created ${body.discovered} ${kindLabel(kind).toLowerCase()} sources`
          : "Identity mapping saved",
      );
      onSaved?.(body.discovered ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save mapping");
    } finally {
      setSaving(false);
    }
  };

  if (!schema || tables.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tables available — check the connection first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Table</Label>
          <Select value={tableKey} onValueChange={setTableKey}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Pick a table" />
            </SelectTrigger>
            <SelectContent>
              {tables.map((t) => {
                const key = t.schema ? `${t.schema}.${t.name}` : t.name;
                return (
                  <SelectItem key={key} value={key}>
                    {key}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Identity column
          </Label>
          <Select
            value={idColumn}
            onValueChange={setIdColumn}
            disabled={!table}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Which column names them?" />
            </SelectTrigger>
            <SelectContent>
              {columnOptions.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Kind</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_KINDS.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="min-h-[2rem] text-sm">
        {previewing ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="h-3.5 w-3.5" /> Counting…
          </span>
        ) : preview ? (
          <div className="space-y-1">
            <p>
              Found{" "}
              <span className="font-medium">
                {preview.count}
                {preview.truncated ? "+" : ""}
              </span>{" "}
              distinct values — each becomes a{" "}
              {kindLabel(kind).toLowerCase()} source.
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {preview.sample
                .slice(0, 6)
                .map((s) => s.value)
                .join(" · ")}
              {preview.count > 6 ? " · …" : ""}
            </p>
          </div>
        ) : idColumn ? (
          <span className="text-muted-foreground">Preview unavailable.</span>
        ) : null}
      </div>

      <Button
        onClick={handleSave}
        disabled={!table || !idColumn || saving || previewing}
        loading={saving}
      >
        {preview && preview.count > 0
          ? `Create ${preview.count}${preview.truncated ? "+" : ""} sources`
          : "Save mapping"}
      </Button>
    </div>
  );
}

function kindLabel(id: string): string {
  return SOURCE_KINDS.find((k) => k.id === id)?.label ?? id;
}

// ===========================================================================
// Scope columns — "also match identity under"
// ===========================================================================

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface ScopeColumnsEditorProps {
  /** Connection source id (uuid) — config PATCHes shallow-merge. */
  sourceId: string;
  schema: MappingSchema | null;
  scopeColumns: string[];
  onSaved?: () => void;
}

/**
 * Extra identity columns for row scoping. Discovery's idColumn defines WHO an
 * entity is; some tables reference the same entity under other columns
 * (conjunction_event's sat_id_1/sat_id_2 name the two objects). Row scoping
 * (lib/access/entity-scope.ts) matches entity values against the association
 * column PLUS these — so multi-column tables stay visible to scoped members.
 *
 * Add/remove saves immediately, matching this tab's TableSelector behavior.
 */
export function ScopeColumnsEditor({
  sourceId,
  schema,
  scopeColumns,
  onSaved,
}: ScopeColumnsEditorProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const candidates = useMemo(() => {
    const cols = new Set<string>();
    for (const t of schema?.tables ?? []) {
      for (const c of t.columns) {
        if (SAFE_IDENT.test(c.name)) cols.add(c.name);
      }
    }
    for (const c of scopeColumns) cols.delete(c);
    const q = query.trim().toLowerCase();
    return [...cols]
      .filter((c) => !q || c.toLowerCase().includes(q))
      .sort()
      .slice(0, 40);
  }, [schema, scopeColumns, query]);

  const save = async (next: string[]) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/sources/${sourceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { scopeColumns: next } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const add = (col: string) => {
    if (!SAFE_IDENT.test(col) || scopeColumns.includes(col)) return;
    setQuery("");
    setOpen(false);
    void save([...scopeColumns, col].sort());
  };

  return (
    <div className="space-y-1.5">
      <div>
        <Label className="text-xs text-muted-foreground">
          Also match identity under
        </Label>
        <p className="text-[11px] text-muted-foreground">
          Some tables name the same entity in other columns (e.g. sat_id_1 /
          sat_id_2 in conjunction rows). Row scoping matches these too.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {scopeColumns.map((col) => (
          <span
            key={col}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-xs"
          >
            {col}
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              disabled={saving}
              aria-label={`Stop matching ${col}`}
              onClick={() => void save(scopeColumns.filter((c) => c !== col))}
            >
              ×
            </button>
          </span>
        ))}
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setQuery("");
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={saving}
            >
              + Add column
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 p-0">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search columns…"
              autoFocus
              className="h-8 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter" && SAFE_IDENT.test(query.trim())) {
                  e.preventDefault();
                  add(query.trim());
                }
              }}
            />
            <div className="max-h-52 overflow-auto py-1">
              {candidates.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {SAFE_IDENT.test(query.trim())
                    ? "Press Enter to add"
                    : "No matching columns"}
                </p>
              ) : (
                candidates.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => add(col)}
                    className="flex w-full items-center px-3 py-1.5 text-left font-mono text-xs transition-colors hover:bg-muted/50"
                  >
                    {col}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
