"use client";

/**
 * Dashboard Toolbar
 *
 * Unified control row combining: time range, dashboard filters (variables),
 * and data filters — all rendered as filter chips.
 *
 * Layout: [Time Range ▾] [Region: US] [Satellite: ISS] [altitude > 500] [+]
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Calendar } from "@/components/ui/calendar";
import { Spinner } from "@/components/ui/spinner";
import {
  Filter,
  Plus,
  X,
  Variable,
  Lock,
} from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { useSourcesSwr } from "@/hooks/use-sources-swr";
import { useFormattedTime } from "@/hooks/use-formatted-time";
import {
  formatDateTimeInZone,
  convertToTimezone,
} from "@/lib/timezone";
import type {
  DataFilter,
  NumericOperator,
  StringOperator,
  TimeRange,
} from "@/lib/types/dashboard";
import { useDashboardVariables } from "./dashboard-state-context";
import { useDashboardInteraction } from "./dashboard-interaction-context";
import { TimeRangePicker } from "./time-range-picker";

const ALL_OPERATORS = [
  { value: "=", label: "=" },
  { value: "!=", label: "!=" },
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
  { value: "contains", label: "contains" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
];

interface DashboardToolbarProps {
  /** Dashboard time range */
  timeRange: TimeRange;
  /** Callback when time range changes */
  onTimeRangeChange: (timeRange: TimeRange) => void;
  /** Auto-refresh interval in ms (0 = off) */
  refreshInterval?: number;
  /** Callback when refresh interval changes */
  onRefreshIntervalChange?: (interval: number) => void;
  /** Dashboard-level filters */
  filters: DataFilter[];
  /** Callback when filters change */
  onFiltersChange: (filters: DataFilter[]) => void;
  /** Available fields for filter dropdowns */
  availableFields: string[];
}

export function DashboardToolbar({
  timeRange,
  onTimeRangeChange,
  filters,
  onFiltersChange,
  availableFields,
}: DashboardToolbarProps) {
  const { variables, values, setValue, options, loading } =
    useDashboardVariables();
  const { isLive, goLive } = useDashboardInteraction();
  const { timezone, use12Hour } = useFormattedTime();

  const [addOpen, setAddOpen] = useState(false);
  const [newField, setNewField] = useState("");
  const [newOperator, setNewOperator] = useState<string>(">");
  const [newValue, setNewValue] = useState("");

  const handleToggleFilter = (index: number) => {
    const updated = [...filters];
    updated[index] = {
      ...updated[index],
      enabled: !(updated[index].enabled !== false),
    };
    onFiltersChange(updated);
  };

  const handleRemoveFilter = (index: number) => {
    onFiltersChange(filters.filter((_, i) => i !== index));
  };

  const handleAddFilter = () => {
    if (!newField || newValue === "") return;
    const numVal = parseFloat(newValue);
    const value = !isNaN(numVal) && newValue.trim() !== "" ? numVal : newValue;
    const filter: DataFilter = {
      field: newField,
      operator: newOperator as NumericOperator | StringOperator,
      value,
      enabled: true,
    };
    onFiltersChange([...filters, filter]);
    setAddOpen(false);
    setNewValue("");
  };

  const handleOpenChange = (open: boolean) => {
    setAddOpen(open);
    if (open && availableFields.length > 0) {
      setNewField(availableFields[0]);
      setNewOperator(">");
      setNewValue("");
    }
  };

  const formatFilterLabel = (f: DataFilter) => {
    const field = f.field.includes(":") ? f.field.split(":")[1] : f.field;
    return `${field} ${f.operator} ${f.value}`;
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <TimeRangePicker
        value={timeRange}
        onChange={onTimeRangeChange}
        isLive={isLive}
        onGoLive={goLive}
      />

      {variables.map((v) => {
        const isDateVar =
          v.type === "text" && /epoch|date|time|start/i.test(v.name);
        const currentValue = values[v.name] ?? "";
        const displayValue =
          isDateVar && currentValue
            ? formatDateTimeInZone(new Date(currentValue), timezone, use12Hour)
            : currentValue || "...";

        return (
          <Popover key={v.name}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border h-auto bg-primary/10 border-primary/30 text-foreground hover:bg-primary/15 transition-colors">
                <Variable className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="max-w-[160px] truncate">
                  {v.label}: {displayValue}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-auto p-3 space-y-2"
              align="start"
              sideOffset={4}
            >
              <div className="text-xs font-medium">{v.label}</div>

              {/* Date variable — Calendar + time picker */}
              {isDateVar && (
                <>
                  <Calendar
                    mode="single"
                    selected={currentValue ? new Date(currentValue) : undefined}
                    onSelect={(date) => {
                      if (date) {
                        const current = currentValue
                          ? new Date(currentValue)
                          : new Date();
                        date.setHours(
                          current.getHours(),
                          current.getMinutes(),
                          current.getSeconds(),
                        );
                        setValue(v.name, date.toISOString().slice(0, 19));
                      }
                    }}
                  />
                  <div className="border-t border-border pt-2">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground w-10">
                        Time
                      </label>
                      <Input
                        type="time"
                        step="1"
                        value={
                          currentValue
                            ? (() => {
                                const inTz = convertToTimezone(
                                  new Date(currentValue),
                                  timezone,
                                );
                                return `${String(inTz.getHours()).padStart(2, "0")}:${String(inTz.getMinutes()).padStart(2, "0")}:${String(inTz.getSeconds()).padStart(2, "0")}`;
                              })()
                            : "00:00:00"
                        }
                        onChange={(e) => {
                          const datePart = (
                            currentValue || new Date().toISOString()
                          ).slice(0, 10);
                          setValue(v.name, `${datePart}T${e.target.value}`);
                        }}
                        className="h-8 text-xs font-mono flex-1"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Text variable — Input */}
              {!isDateVar && v.type === "text" && (
                <Input
                  value={currentValue}
                  onChange={(e) => setValue(v.name, e.target.value)}
                  className="h-7 text-xs"
                  placeholder={v.defaultValue || v.name}
                />
              )}

              {/* Query/Custom variable — Select dropdown */}
              {!isDateVar &&
                v.type !== "text" &&
                (loading[v.name] ? (
                  <Spinner className="h-3 w-3" />
                ) : (
                  <Select
                    value={currentValue}
                    onValueChange={(val) => setValue(v.name, val)}
                  >
                    <SelectTrigger className="h-7 min-w-[120px] text-xs">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(options[v.name] ?? []).map((opt) => (
                        <SelectItem key={opt} value={opt} className="text-xs">
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ))}
            </PopoverContent>
          </Popover>
        );
      })}

      {/* ── Access scope chip (locked) — scope is a wall the server adds;
           shown in the same chip language as filters, but never editable. ── */}
      <ScopeChip />

      {/* ── Data filter chips ── */}
      {filters.map((filter, index) => (
        <Button
          key={index}
          variant="ghost"
          size="sm"
          className={`
            inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border h-auto
            ${
              filter.enabled !== false
                ? "bg-primary/10 border-primary/30 text-foreground"
                : "bg-muted/50 border-muted-foreground/20 text-muted-foreground line-through"
            }
          `}
          onClick={() => handleToggleFilter(index)}
        >
          <Filter className="h-2.5 w-2.5" />
          <span className="max-w-[120px] truncate">
            {formatFilterLabel(filter)}
          </span>
          <span
            role="button"
            className="hover:text-destructive ml-0.5"
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveFilter(index);
            }}
          >
            <X className="h-2.5 w-2.5" />
          </span>
        </Button>
      ))}

      {/* ── Add filter ── */}
      {availableFields.length > 0 && (
        <Popover open={addOpen} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            >
              <Plus className="h-3 w-3" />
              {filters.length === 0 && variables.length === 0 ? "Filter" : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3 space-y-3" align="start">
            <div className="text-xs font-medium">Add Filter</div>
            <div className="space-y-2">
              <Select value={newField} onValueChange={setNewField}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Field" />
                </SelectTrigger>
                <SelectContent>
                  {availableFields.map((field) => (
                    <SelectItem key={field} value={field} className="text-xs">
                      {field.includes(":") ? field.split(":")[1] : field}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={newOperator} onValueChange={setNewOperator}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_OPERATORS.map((op) => (
                    <SelectItem
                      key={op.value}
                      value={op.value}
                      className="text-xs"
                    >
                      {op.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="h-7 text-xs"
                placeholder="Value"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddFilter();
                }}
              />
            </div>
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleAddFilter}
            >
              Add Filter
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/**
 * Locked chip showing the viewer's access scope. Scoped members always see it
 * (predictability over minimalism — decided with Ann): their visible sources
 * ARE their scope, so the already-filtered sources list supplies the names.
 * No X, no toggle — filters are lenses you choose; scope is a wall an admin
 * set.
 */
function ScopeChip() {
  const { scoped } = usePermissions();
  const { sources } = useSourcesSwr();

  if (!scoped) return null;
  const names = (sources ?? []).map((s) => s.name || s.slug);
  const shown = names.slice(0, 2).join(", ");
  const more = names.length - 2;

  return (
    <span
      className="inline-flex h-auto items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
      title="Your access is limited to these sources — set by an admin."
    >
      <Lock className="h-2.5 w-2.5" />
      <span className="max-w-[160px] truncate">
        Scoped{names.length > 0 ? ` · ${shown}` : ""}
        {more > 0 ? ` +${more}` : ""}
      </span>
    </span>
  );
}
