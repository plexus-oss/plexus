"use client";

/**
 * Filter Builder — Linear/Vercel-style chip filters.
 *
 * Each filter renders as a pill that reads like a sentence:
 *   [field ▾]  [op ▾]  [value]   ×
 *
 * "Add filter" opens a field picker popover first, then drops a new filter
 * in with sensible defaults. Dashboard-inherited filters render as muted,
 * non-editable chips with a "from dashboard" hint.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, X, ChevronDown, Lock, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DataFilter,
  NumericOperator,
  StringOperator,
} from "@/lib/types/dashboard";

interface FilterBuilderProps {
  filters: DataFilter[];
  onChange: (filters: DataFilter[]) => void;
  availableFields: string[];
  dashboardFilters?: DataFilter[];
  excludedDashboardFilters?: string[];
  onExcludedChange?: (excluded: string[]) => void;
}

const OPERATORS: Array<{
  value: NumericOperator | StringOperator;
  label: string;
  group: "compare" | "text";
}> = [
  { value: "=", label: "is", group: "compare" },
  { value: "!=", label: "is not", group: "compare" },
  { value: ">", label: ">", group: "compare" },
  { value: ">=", label: "≥", group: "compare" },
  { value: "<", label: "<", group: "compare" },
  { value: "<=", label: "≤", group: "compare" },
  { value: "contains", label: "contains", group: "text" },
  { value: "startsWith", label: "starts with", group: "text" },
  { value: "endsWith", label: "ends with", group: "text" },
];

function FieldPicker({
  fields,
  onPick,
  placeholder = "Search field…",
}: {
  fields: string[];
  onPick: (field: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.toLowerCase();
  const filtered = q
    ? fields.filter((f) => f.toLowerCase().includes(q))
    : fields;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-2 h-8 border-b border-border">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoFocus
          className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="max-h-56 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground text-center">
            No fields
          </div>
        ) : (
          filtered.map((f) => (
            <button
              key={f}
              onClick={() => onPick(f)}
              className="w-full text-left px-2 h-7 rounded text-xs hover:bg-muted transition-colors truncate"
            >
              {displayName(f)}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function displayName(field: string) {
  return field.includes(":") ? field.split(":")[1] : field;
}

function operatorLabel(op: string) {
  return OPERATORS.find((o) => o.value === op)?.label ?? op;
}

/** Inline chip button styled like a Linear filter segment. */
function ChipButton({
  children,
  onClick,
  className,
  disabled,
  asTrigger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  asTrigger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 h-6 px-1.5 rounded text-xs font-medium transition-colors",
        "hover:bg-muted disabled:opacity-60 disabled:cursor-not-allowed",
        asTrigger && "data-[state=open]:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function FilterBuilder({
  filters,
  onChange,
  availableFields,
  dashboardFilters = [],
  excludedDashboardFilters,
  onExcludedChange,
}: FilterBuilderProps) {
  void excludedDashboardFilters;
  void onExcludedChange;

  const [addOpen, setAddOpen] = useState(false);

  const updateFilter = (index: number, updates: Partial<DataFilter>) => {
    const next = [...filters];
    next[index] = { ...next[index], ...updates };
    onChange(next);
  };

  const removeFilter = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  const addFilter = (field: string) => {
    const next: DataFilter = {
      field,
      operator: "=",
      value: "",
      enabled: true,
    };
    onChange([...filters, next]);
    setAddOpen(false);
  };

  const enabledDashboardFilters = dashboardFilters.filter(
    (f) => f.enabled !== false,
  );

  return (
    <div className="space-y-1.5">
      {/* Dashboard-inherited filters (read-only) */}
      {enabledDashboardFilters.map((filter, index) => (
        <div
          key={`dashboard-${index}`}
          className="group flex items-center h-8 px-2 rounded-md border border-dashed border-border bg-muted/30 text-xs text-muted-foreground"
          title="Inherited from dashboard. Add a panel filter on this field to override."
        >
          <Lock className="h-3 w-3 mr-1.5 shrink-0" />
          <span className="font-medium text-foreground/80">
            {displayName(filter.field)}
          </span>
          <span className="mx-1.5">{operatorLabel(filter.operator)}</span>
          <span className="font-mono text-foreground/70 truncate">
            {String(filter.value)}
          </span>
          <span className="ml-auto text-[10px] uppercase tracking-wide opacity-70">
            Dashboard
          </span>
        </div>
      ))}

      {/* Panel-level filters */}
      {filters.map((filter, index) => {
        const enabled = filter.enabled !== false;
        return (
          <div
            key={index}
            className={cn(
              "group flex items-center h-8 pl-1 pr-1 rounded-md border bg-background transition-colors",
              enabled
                ? "border-border"
                : "border-dashed border-border opacity-60",
            )}
          >
            {/* Enable dot */}
            <button
              onClick={() => updateFilter(index, { enabled: !enabled })}
              title={enabled ? "Disable filter" : "Enable filter"}
              className={cn(
                "w-5 h-5 rounded flex items-center justify-center hover:bg-muted transition-colors shrink-0",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  enabled ? "bg-primary" : "bg-muted-foreground/40",
                )}
              />
            </button>

            {/* Field picker */}
            <Popover>
              <PopoverTrigger asChild>
                <ChipButton asTrigger className="text-foreground">
                  <span className="truncate max-w-[120px]">
                    {displayName(filter.field)}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </ChipButton>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0" align="start">
                <FieldPicker
                  fields={availableFields}
                  onPick={(f) => updateFilter(index, { field: f })}
                />
              </PopoverContent>
            </Popover>

            {/* Operator picker */}
            <Popover>
              <PopoverTrigger asChild>
                <ChipButton asTrigger className="text-muted-foreground">
                  {operatorLabel(filter.operator)}
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </ChipButton>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-1" align="start">
                <div className="space-y-0.5">
                  {OPERATORS.map((op) => (
                    <button
                      key={op.value}
                      onClick={() =>
                        updateFilter(index, { operator: op.value })
                      }
                      className={cn(
                        "w-full text-left px-2 h-7 rounded text-xs hover:bg-muted transition-colors",
                        filter.operator === op.value &&
                          "bg-muted font-medium",
                      )}
                    >
                      {op.label}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {/* Value */}
            <Input
              value={String(filter.value)}
              onChange={(e) => {
                const val = e.target.value;
                const numVal = parseFloat(val);
                updateFilter(index, {
                  value:
                    !isNaN(numVal) && val.trim() !== "" && /^-?\d*\.?\d+$/.test(val)
                      ? numVal
                      : val,
                });
              }}
              placeholder="value"
              className="h-6 text-xs px-1.5 flex-1 min-w-0 border-0 shadow-none focus-visible:ring-0 bg-transparent"
            />

            {/* Remove */}
            <button
              onClick={() => removeFilter(index)}
              className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
              title="Remove filter"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      {/* Add filter */}
      {availableFields.length > 0 && (
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-1.5 h-8 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors w-full",
                "border border-dashed border-border",
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              Add filter
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <FieldPicker
              fields={availableFields}
              onPick={addFilter}
              placeholder="Filter by…"
            />
          </PopoverContent>
        </Popover>
      )}

      {/* Empty state */}
      {availableFields.length === 0 &&
        filters.length === 0 &&
        enabledDashboardFilters.length === 0 && (
          <p className="text-xs text-muted-foreground py-1">
            No fields available to filter
          </p>
        )}
    </div>
  );
}
