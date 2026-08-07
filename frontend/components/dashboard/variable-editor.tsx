"use client";

/**
 * Dashboard Filter Editor
 *
 * Create, edit, and delete dashboard filters (variables).
 * Filters parameterize queries with $name references and show
 * as filter chips in the dashboard toolbar.
 */

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { DeleteButton } from "@/components/ui/delete-button";
import type { DashboardVariable, DashboardVariableType } from "@/lib/types/dashboard";

interface VariableEditorProps {
  variables: DashboardVariable[];
  onChange: (variables: DashboardVariable[]) => void;
  canEdit: boolean;
}

const TYPE_LABELS: Record<DashboardVariableType, string> = {
  text: "Text input",
  query: "Query (SQL)",
  custom: "Custom list",
};

const TYPE_DESCRIPTIONS: Record<DashboardVariableType, string> = {
  text: "Free-form text input. Use for timestamps, IDs, or any value.",
  query: "Populate options from a SQL query. First column is used as values.",
  custom: "Comma-separated list of values.",
};

export function VariableEditor({ variables, onChange, canEdit }: VariableEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const addVariable = useCallback(() => {
    const newVar: DashboardVariable = {
      name: `var_${variables.length + 1}`,
      label: `Filter ${variables.length + 1}`,
      type: "text",
      current: "",
      defaultValue: "",
    };
    onChange([...variables, newVar]);
    setEditingIndex(variables.length);
  }, [variables, onChange]);

  const updateVariable = useCallback(
    (index: number, updates: Partial<DashboardVariable>) => {
      const updated = variables.map((v, i) => (i === index ? { ...v, ...updates } : v));
      onChange(updated);
    },
    [variables, onChange],
  );

  const deleteVariable = useCallback(
    (index: number) => {
      onChange(variables.filter((_, i) => i !== index));
      setEditingIndex(null);
    },
    [variables, onChange],
  );

  return (
    <div className="space-y-4">
      {variables.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">No dashboard filters defined</p>
          <p className="text-[12px] text-muted-foreground/60 mt-1">
            Dashboard filters parameterize queries with $name references
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {variables.map((variable, index) => (
            <div key={index}>
              {editingIndex === index ? (
                <VariableForm
                  variable={variable}
                  onUpdate={(updates) => updateVariable(index, updates)}
                  onDelete={() => deleteVariable(index)}
                  onClose={() => setEditingIndex(null)}
                />
              ) : (
                <button
                  onClick={canEdit ? () => setEditingIndex(index) : undefined}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{variable.label}</span>
                      <span className="text-[11px] text-muted-foreground font-mono">${variable.name}</span>
                    </div>
                    <span className="text-[12px] text-muted-foreground">
                      {TYPE_LABELS[variable.type]}
                      {variable.defaultValue && ` · default: ${variable.defaultValue}`}
                    </span>
                  </div>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <Button
          variant="outline"
          size="sm"
          onClick={addVariable}
          className="w-full"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add filter
        </Button>
      )}
    </div>
  );
}

// ─── Variable Form (inline editor) ─────────────────────────────────────────

function VariableForm({
  variable,
  onUpdate,
  onDelete,
  onClose,
}: {
  variable: DashboardVariable;
  onUpdate: (updates: Partial<DashboardVariable>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/10">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Edit filter</span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Name</Label>
          <Input
            value={variable.name}
            onChange={(e) =>
              onUpdate({ name: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })
            }
            className="h-8 text-[13px] font-mono"
            placeholder="my_variable"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Label</Label>
          <Input
            value={variable.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
            className="h-8 text-[13px]"
            placeholder="My Variable"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Type</Label>
        <Select
          value={variable.type}
          onValueChange={(v) => onUpdate({ type: v as DashboardVariableType })}
        >
          <SelectTrigger className="h-8 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TYPE_LABELS) as DashboardVariableType[]).map((type) => (
              <SelectItem key={type} value={type} className="text-[13px]">
                {TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground/60">{TYPE_DESCRIPTIONS[variable.type]}</p>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Default value</Label>
        <Input
          value={variable.defaultValue || ""}
          onChange={(e) => onUpdate({ defaultValue: e.target.value, current: e.target.value })}
          className="h-8 text-[13px]"
          placeholder="Default value..."
        />
      </div>

      {variable.type === "query" && (
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">SQL query</Label>
          <Textarea
            value={variable.queryString || ""}
            onChange={(e) => onUpdate({ queryString: e.target.value })}
            className="text-[12px] font-mono min-h-[60px] resize-y"
            placeholder="SELECT DISTINCT sat_id FROM satellite_base ORDER BY sat_id"
          />
        </div>
      )}

      {variable.type === "custom" && (
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Values (comma-separated)</Label>
          <Input
            value={variable.customValues || ""}
            onChange={(e) => onUpdate({ customValues: e.target.value })}
            className="h-8 text-[13px]"
            placeholder="value1, value2, value3"
          />
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <DeleteButton
          label="Delete"
          entityName={variable.name}
          onConfirm={onDelete}
          skipConfirm
        />
        <p className="text-[11px] text-muted-foreground">
          Use <code className="bg-muted px-1 rounded text-[10px]">${variable.name}</code> in queries
        </p>
      </div>
    </div>
  );
}
