"use client";

import { useState, useMemo } from "react";
import { Table2 } from "lucide-react";
import { useConnectionSchema } from "@/hooks/use-connection-schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface TableSelectorProps {
  sourceId: string;
  config: Record<string, unknown>;
  onUpdate: (selectedTables: string[]) => void;
}

export function TableSelector({
  sourceId,
  config,
  onUpdate,
}: TableSelectorProps) {
  const { tables, isLoading, error } = useConnectionSchema(sourceId, {
    showAll: true,
  });

  const savedSelection = config?.selectedTables as string[] | undefined;
  const [isSaving, setIsSaving] = useState(false);

  const allTableNames = useMemo(
    () => tables.map((t) => (t.schema ? `${t.schema}.${t.name}` : t.name)),
    [tables],
  );

  // The current selection — defaults to all tables if nothing saved
  const [localSelection, setLocalSelection] = useState<Set<string> | null>(
    null,
  );

  const activeSelection = useMemo(() => {
    if (localSelection) return localSelection;
    if (!savedSelection || savedSelection.length === 0) {
      return new Set(allTableNames);
    }
    // Intersect saved selection with actual table names to discard stale entries
    const valid = new Set(allTableNames);
    const filtered = savedSelection.filter((name) => valid.has(name));
    // If all saved entries were stale, default to selecting everything
    if (filtered.length === 0) return new Set(allTableNames);
    return new Set(filtered);
  }, [savedSelection, allTableNames, localSelection]);

  // Sync local selection when tables load and there's no local override yet
  const isDirty = localSelection !== null;

  const toggleTable = (fullName: string) => {
    const next = new Set(activeSelection);
    if (next.has(fullName)) {
      next.delete(fullName);
    } else {
      next.add(fullName);
    }
    setLocalSelection(next);
  };

  const toggleAll = () => {
    if (activeSelection.size === allTableNames.length) {
      setLocalSelection(new Set());
    } else {
      setLocalSelection(new Set(allTableNames));
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate(Array.from(activeSelection));
      setLocalSelection(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setLocalSelection(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Spinner className="h-3.5 w-3.5" />
        Loading tables...
      </div>
    );
  }

  if (error || tables.length === 0) {
    return null;
  }

  const allSelected = activeSelection.size === allTableNames.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Choose which tables appear in the Data page and dashboards.
        </p>
        <Button
          variant="link"
          size="sm"
          onClick={toggleAll}
          className="text-xs text-primary hover:underline shrink-0 h-auto p-0"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </Button>
      </div>

      <div className="max-h-[73vh] overflow-y-auto border rounded-lg divide-y">
        {tables.map((table, idx) => {
          const fullName = table.schema
            ? `${table.schema}.${table.name}`
            : table.name;
          const isSelected = activeSelection.has(fullName);

          return (
            <Label
              key={`${fullName}-${idx}`}
              className={cn(
                "flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/50 transition-colors",
                isSelected && "bg-primary/5",
              )}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleTable(fullName)}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Table2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-mono text-sm truncate">
                    {table.name}
                  </span>
                  {table.schema && table.schema !== "public" && (
                    <span className="text-xs text-muted-foreground">
                      ({table.schema})
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 ml-6">
                  {table.columns.length} columns
                </div>
              </div>
            </Label>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {activeSelection.size} of {tables.length} tables selected
        </span>
        {isDirty && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="h-7 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              loading={isSaving}
              className="h-7 text-xs"
            >
              Save Selection ({activeSelection.size})
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
