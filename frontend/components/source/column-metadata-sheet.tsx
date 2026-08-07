"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { toast } from "@/lib/toast-utils";
import { useColumnMetadata } from "@/hooks/use-column-metadata";
import type {
  ColumnSemanticType,
  ColumnMlRole,
  ColumnAggregation,
  ColumnSensitivity,
} from "@/lib/db/types";
import type { UpsertColumnMetadata } from "@/lib/validation/api-schemas";

const UNSET = "__unset__";

const SEMANTIC_TYPES: ColumnSemanticType[] = [
  "identifier",
  "category",
  "measurement",
  "status",
  "location",
  "timestamp",
  "text",
  "boolean",
];
const ML_ROLES: ColumnMlRole[] = ["feature", "target", "identifier", "ignore"];
const AGGREGATIONS: ColumnAggregation[] = [
  "avg",
  "sum",
  "min",
  "max",
  "last",
  "none",
];
const SENSITIVITIES: ColumnSensitivity[] = ["none", "pii", "sensitive"];

// Common unit presets surfaced in the datalist; users can type anything.
const UNIT_PRESETS = [
  "V",
  "A",
  "W",
  "°C",
  "°F",
  "K",
  "%",
  "RPM",
  "Hz",
  "m",
  "km",
  "m/s",
  "km/h",
  "Pa",
  "hPa",
  "bar",
  "psi",
  "g",
  "kg",
  "dB",
  "lux",
  "ppm",
];

interface FormState {
  label: string;
  unit: string;
  semantic_type: ColumnSemanticType | typeof UNSET;
  ml_role: ColumnMlRole | typeof UNSET;
  aggregation: ColumnAggregation | typeof UNSET;
  description: string;
  tags: string;
  sensitivity: ColumnSensitivity;
}

const EMPTY_FORM: FormState = {
  label: "",
  unit: "",
  semantic_type: UNSET,
  ml_role: UNSET,
  aggregation: UNSET,
  description: "",
  tags: "",
  sensitivity: "none",
};

interface ColumnMetadataSheetProps {
  /** id or slug of the source — used to key the API. */
  sourceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The column being annotated. */
  columnKey: string;
  columnName: string;
  inferredType: string;
  /** A few sample values from the table, used to seed AI suggestions. */
  sampleValues?: unknown[];
}

export function ColumnMetadataSheet({
  sourceId,
  open,
  onOpenChange,
  columnKey,
  columnName,
  inferredType,
  sampleValues = [],
}: ColumnMetadataSheetProps) {
  const { byKey, upsertColumn, removeColumn, suggest } =
    useColumnMetadata(sourceId);
  const existing = byKey.get(columnKey);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [usedAi, setUsedAi] = useState(false);

  // Reset the form from the persisted record whenever the sheet (re)opens or
  // the target column changes. Implemented as the React "adjust state during
  // render" pattern (https://react.dev/learn/you-might-not-need-an-effect):
  // we track the column the form was last seeded from and re-seed when it
  // differs, without re-seeding when `existing` refetches under a stable column.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (!open) {
    if (seededFor !== null) setSeededFor(null);
  } else if (columnKey !== seededFor) {
    setSeededFor(columnKey);
    setUsedAi(false);
    setForm(
      existing
        ? {
            label: existing.label ?? "",
            unit: existing.unit ?? "",
            semantic_type: existing.semantic_type ?? UNSET,
            ml_role: existing.ml_role ?? UNSET,
            aggregation: existing.aggregation ?? UNSET,
            description: existing.description ?? "",
            tags: (existing.tags ?? []).join(", "),
            sensitivity: existing.sensitivity ?? "none",
          }
        : EMPTY_FORM,
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSuggest = async () => {
    setSuggesting(true);
    try {
      const [s] = await suggest([
        {
          column_key: columnKey,
          inferred_type: inferredType,
          sample_values: sampleValues.slice(0, 5),
        },
      ]);
      if (!s) {
        toast.info("No suggestion available for this column");
        return;
      }
      setForm((f) => ({
        ...f,
        label: s.label ?? f.label,
        unit: s.unit ?? f.unit,
        semantic_type: s.semantic_type ?? f.semantic_type,
        ml_role: s.ml_role ?? f.ml_role,
        aggregation: s.aggregation ?? f.aggregation,
        description: s.description ?? f.description,
      }));
      setUsedAi(true);
      toast.success("Suggestion applied — review and save");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suggestion failed");
    } finally {
      setSuggesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: UpsertColumnMetadata = {
        label: form.label.trim() || null,
        unit: form.unit.trim() || null,
        description: form.description.trim() || null,
        semantic_type: form.semantic_type === UNSET ? null : form.semantic_type,
        ml_role: form.ml_role === UNSET ? null : form.ml_role,
        aggregation: form.aggregation === UNSET ? null : form.aggregation,
        sensitivity: form.sensitivity,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        source_origin: usedAi ? "ai_accepted" : "user",
      };
      await upsertColumn(columnKey, patch);
      toast.success(`Saved metadata for "${columnName}"`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await removeColumn(columnKey);
      toast.success(`Cleared metadata for "${columnName}"`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="font-mono text-sm">{columnName}</SheetTitle>
          <SheetDescription>
            Annotate this column so Plexus can do better inference on the data.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 px-6 py-5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleSuggest}
            loading={suggesting}
          >
            Suggest
          </Button>

          <Field label="Label">
            <Input
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder={columnName}
            />
          </Field>

          <Field label="Unit">
            <Input
              list="column-unit-presets"
              value={form.unit}
              onChange={(e) => set("unit", e.target.value)}
              placeholder="e.g. V, °C, %"
            />
            <datalist id="column-unit-presets">
              {UNIT_PRESETS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>

          <Field label="Semantic role">
            <EnumSelect
              value={form.semantic_type}
              onChange={(v) =>
                set("semantic_type", v as FormState["semantic_type"])
              }
              options={SEMANTIC_TYPES}
              placeholder="Select a role"
            />
          </Field>

          <Field label="ML role">
            <EnumSelect
              value={form.ml_role}
              onChange={(v) => set("ml_role", v as FormState["ml_role"])}
              options={ML_ROLES}
              placeholder="How ML should treat it"
            />
          </Field>

          <Field label="Aggregation">
            <EnumSelect
              value={form.aggregation}
              onChange={(v) =>
                set("aggregation", v as FormState["aggregation"])
              }
              options={AGGREGATIONS}
              placeholder="Default rollup"
            />
          </Field>

          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What does this column represent?"
              rows={3}
            />
          </Field>

          <Field label="Tags">
            <Input
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="comma, separated, tags"
            />
          </Field>

          <Field label="Sensitivity">
            <Select
              value={form.sensitivity}
              onValueChange={(v) => set("sensitivity", v as ColumnSensitivity)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SENSITIVITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "none" ? "Not sensitive" : s.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={handleClear}
            disabled={saving || !existing}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              loading={saving}
            >
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function EnumSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>
          <span className="text-muted-foreground">None</span>
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o} className="capitalize">
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
