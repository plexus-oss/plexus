"use client";

/**
 * SqlEditor — the custom-SQL escape hatch, upgraded from a bare textarea:
 * an explicit Run button (⌘/Ctrl+Enter), an inline result strip (row count +
 * first rows + column role chips), and inline errors instead of toast-only
 * feedback. Macro insert buttons cover $__timeFilter / $__timeGroup so users
 * don't have to memorize them.
 */

import { useRef, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useConnectionQueryManual } from "@/hooks/use-connection-query";
import { substituteVariables } from "@/lib/transforms/connection-query";
import { classifyColumn, type ColumnRole } from "@/lib/dashboard/column-roles";
import type { TimeRange } from "@/lib/types/dashboard";
import { cn } from "@/lib/utils";

// Same sentinel used by use-connection-query / data-source-selector.
const PLEXUS_SOURCE_ID = "__plexus__";

const PREVIEW_ROWS = 5;

const ROLE_STYLES: Record<ColumnRole, string> = {
  time: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  measure: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  dimension: "bg-muted text-muted-foreground",
};

interface SqlEditorProps {
  sourceId: string;
  query: string;
  onChange: (query: string) => void;
  /** Detected time column — seeds the macro insert buttons. */
  timeColumn?: string;
  timeRange?: TimeRange;
  variables?: Record<string, string>;
}

export function SqlEditor({
  sourceId,
  query,
  onChange,
  timeColumn,
  timeRange,
  variables,
}: SqlEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [ran, setRan] = useState(false);
  const { result, isLoading, error, execute } =
    useConnectionQueryManual(sourceId);

  const run = async () => {
    setRan(true);
    const dialect = sourceId === PLEXUS_SOURCE_ID ? "clickhouse" : "postgres";
    const { sql } = substituteVariables(
      query,
      variables ?? {},
      timeRange,
      dialect,
    );
    await execute(sql, { limit: 100, silent: true });
  };

  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange(query + snippet);
      return;
    }
    const start = el.selectionStart ?? query.length;
    const end = el.selectionEnd ?? query.length;
    onChange(query.slice(0, start) + snippet + query.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  const col = timeColumn ?? "time";

  return (
    <div className="space-y-1.5">
      <Textarea
        ref={textareaRef}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void run();
          }
        }}
        className="text-xs font-mono min-h-[100px] resize-y"
        placeholder={`SELECT * FROM table WHERE $__timeFilter(${col})`}
      />

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="h-6 px-2 text-[11px] gap-1"
          onClick={() => void run()}
          disabled={isLoading || !query.trim()}
        >
          {isLoading ? (
            <Spinner className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Run
          <kbd className="text-[9px] text-muted-foreground ml-0.5">⌘↵</kbd>
        </Button>
        <button
          type="button"
          onClick={() => insertAtCursor(`$__timeFilter(${col})`)}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted rounded px-1.5 py-0.5"
          title="Filter to the dashboard time range"
        >
          $__timeFilter
        </button>
        <button
          type="button"
          onClick={() => insertAtCursor(`$__timeGroup(${col}, 'day')`)}
          className="text-[10px] font-mono text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted rounded px-1.5 py-0.5"
          title="Bucket timestamps (auto-sized, or 'hour'/'day'/'week'/'month')"
        >
          $__timeGroup
        </button>
      </div>

      {/* Inline error — not a toast */}
      {ran && error && (
        <div className="rounded border border-red-500/40 bg-red-500/5 px-2.5 py-2 text-[11px] text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-words">
          {error.message}
        </div>
      )}

      {/* Inline results */}
      {ran && !error && result && (
        <div className="rounded border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/40 border-b border-border">
            <span className="text-[10px] text-muted-foreground">
              {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
              {result.truncated ? " (truncated)" : ""} ·{" "}
              {result.executionTimeMs}ms
            </span>
            <div className="flex items-center gap-1 flex-wrap">
              {result.columns.map((c) => {
                const role = classifyColumn({ name: c.name, type: c.type });
                return (
                  <span
                    key={c.name}
                    title={`${c.type} — ${role}`}
                    className={cn(
                      "text-[9px] font-mono rounded px-1 py-px",
                      ROLE_STYLES[role],
                    )}
                  >
                    {c.name}
                  </span>
                );
              })}
            </div>
          </div>
          {result.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <tbody>
                  {result.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/50 last:border-0"
                    >
                      {result.columns.map((c) => (
                        <td
                          key={c.name}
                          className="px-2 py-1 whitespace-nowrap text-muted-foreground max-w-40 truncate"
                        >
                          {String(row[c.name] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-2.5 py-2 text-[11px] text-muted-foreground">
              Query ran, but returned no rows in this time range.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
