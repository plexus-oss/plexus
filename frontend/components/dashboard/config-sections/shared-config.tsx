"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DataSource } from "@/lib/types/dashboard";
import { isConnectionSource } from "@/lib/types/dashboard";
import { DASHBOARD_COLORS } from "@/lib/dashboards/colors";

// The canonical config palette — shared with the quick-start auto-builder so
// hand-picked and auto-built dashboards use the same colors.
const COLORS = DASHBOARD_COLORS;

interface SharedConfigProps {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics: string[];
  dataSource: DataSource;
  seriesKeys?: string[];
}

export function SharedConfig({
  config,
  onChange,
  metrics,
  dataSource,
  seriesKeys,
}: SharedConfigProps) {
  const conn = isConnectionSource(dataSource) ? dataSource : null;

  // Combine realtime metrics with connection column names for color pickers
  let connectionCols: string[] = [];
  if (conn) {
    if (conn.selectedColumns && conn.selectedColumns.length > 0) {
      connectionCols = conn.selectedColumns;
    } else if (conn.query) {
      const selectMatch = conn.query.match(/SELECT\s+([\s\S]*?)\s+FROM/i);
      if (selectMatch) {
        connectionCols = selectMatch[1]
          .split(",")
          .map((col) => {
            const trimmed = col.trim();
            const asMatch = trimmed.match(/\bAS\s+"?(\w+)"?\s*$/i);
            if (asMatch) return asMatch[1];
            const dotMatch = trimmed.match(/\.?"?(\w+)"?\s*$/);
            return dotMatch ? dotMatch[1] : trimmed;
          })
          .filter(Boolean);
      }
    }
    const timeCols = new Set([
      "ts",
      "timestamp",
      "time",
      "epoch",
      "ob_time",
      conn.timeColumn || "ts",
    ]);
    connectionCols = connectionCols.filter(
      (c) => !timeCols.has(c.toLowerCase()),
    );
  }

  // Prefer the live rendered series (covers breakdown values); fall back to
  // parsed column names.
  const connectionSeries =
    seriesKeys && seriesKeys.length > 0 ? seriesKeys : connectionCols;
  const colorableMetrics = metrics.length > 0 ? metrics : connectionSeries;

  // Tables in play (base + joined) for the per-table color block.
  const tables: string[] = [];
  if (conn) {
    const base = conn.query?.match(/FROM\s+(\w+)/i)?.[1];
    if (base) tables.push(base);
    for (const j of conn.joins ?? []) tables.push(j.table);
  }
  const showTableColors = !!conn && (tables.length >= 2 || !!conn.seriesColumn);

  const metricColors = (config.metricColors as Record<string, string>) || {};
  const tableColors = (config.tableColors as Record<string, string>) || {};

  // Which table a series belongs to (for the inherited-color preview + hint).
  const tableOf = (key: string): string | undefined => {
    if (!conn) return undefined;
    return conn.seriesColumn
      ? conn.breakdownTable
      : (conn.seriesTableMap as Record<string, string> | undefined)?.[key];
  };

  const handleColorChange = (color: string, metric?: string) => {
    if (metric) {
      onChange({ metricColors: { ...metricColors, [metric]: color } });
    } else {
      onChange({ colors: [color] });
    }
  };

  const handleTableColorChange = (table: string, color: string) => {
    onChange({ tableColors: { ...tableColors, [table]: color } });
  };

  return (
    <>
      {/* By table — default color per source table (series inherit unless overridden) */}
      {showTableColors && (
        <div className="px-3 py-2 border-b border-border">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            By table
          </Label>
          <div className="mt-1.5 space-y-2">
            {tables.map((table, idx) => {
              const current = tableColors[table] || COLORS[idx % COLORS.length];
              return (
                <div key={table} className="flex items-center gap-2">
                  <span
                    className="text-[11px] text-muted-foreground truncate flex-1 min-w-0 font-mono"
                    title={table}
                  >
                    {table}
                  </span>
                  <div className="flex gap-1 shrink-0">
                    {COLORS.map((color) => (
                      <Button
                        key={color}
                        variant="ghost"
                        size="icon"
                        onClick={() => handleTableColorChange(table, color)}
                        className={cn(
                          "w-4 h-4 rounded-full transition-transform p-0 hover:bg-transparent",
                          current === color
                            ? "ring-2 ring-offset-1 ring-offset-background ring-foreground/30 scale-110"
                            : "",
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Colors */}
      <div className="px-3 py-2 border-b border-border">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          {showTableColors
            ? "By series"
            : colorableMetrics.length > 1
              ? "Colors"
              : "Color"}
        </Label>
        {colorableMetrics.length <= 1 ? (
          <div className="flex gap-1.5 mt-1.5">
            {COLORS.map((color) => (
              <Button
                key={color}
                variant="ghost"
                size="icon"
                onClick={() => handleColorChange(color)}
                className={cn(
                  "w-5 h-5 rounded-full transition-transform p-0 hover:bg-transparent",
                  (config.colors as string[])?.[0] === color
                    ? "ring-2 ring-offset-1 ring-offset-background ring-foreground/30 scale-110"
                    : "",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        ) : (
          <div className="mt-1.5 space-y-2">
            {colorableMetrics.map((metric, idx) => {
              const displayName = metric.includes(":")
                ? metric.split(":")[1]
                : metric;
              // explicit override → inherited table default → palette
              const inherited = (() => {
                const t = tableOf(metric);
                return t ? tableColors[t] : undefined;
              })();
              const currentColor =
                metricColors[metric] ||
                inherited ||
                COLORS[idx % COLORS.length];
              return (
                <div key={metric} className="flex items-center gap-2">
                  <span
                    className="text-[11px] text-muted-foreground truncate flex-1 min-w-0"
                    title={metric}
                  >
                    {displayName}
                  </span>
                  <div className="flex gap-1 shrink-0">
                    {COLORS.map((color) => (
                      <Button
                        key={color}
                        variant="ghost"
                        size="icon"
                        onClick={() => handleColorChange(color, metric)}
                        className={cn(
                          "w-4 h-4 rounded-full transition-transform p-0 hover:bg-transparent",
                          currentColor === color
                            ? "ring-2 ring-offset-1 ring-offset-background ring-foreground/30 scale-110"
                            : "",
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Unit */}
      <div className="px-3 py-2 border-b border-border">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Unit
        </Label>
        <Input
          value={(config.unit as string) || ""}
          onChange={(e) => onChange({ unit: e.target.value })}
          className="h-7 text-xs mt-1.5"
          placeholder="e.g., °C, %, rpm"
        />
      </div>

      {/* Decimals & notation */}
      <div className="px-3 py-2 border-b border-border flex gap-3">
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Decimals
          </Label>
          <Input
            type="number"
            min={0}
            max={10}
            value={(config.decimals as number) ?? 2}
            onChange={(e) =>
              onChange({ decimals: parseInt(e.target.value) || 0 })
            }
            className="h-7 text-xs mt-1.5 w-16"
          />
        </div>
        <div className="flex-1">
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Notation
          </Label>
          <Select
            value={(config.notation as string) || "standard"}
            onValueChange={(v) =>
              onChange({ notation: v === "standard" ? undefined : v })
            }
          >
            <SelectTrigger className="h-7 text-xs mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard" className="text-xs">
                Standard
              </SelectItem>
              <SelectItem value="scientific" className="text-xs">
                Scientific
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </>
  );
}
