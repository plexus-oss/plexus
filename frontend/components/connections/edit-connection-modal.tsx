"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Source } from "@/lib/db/types";

interface FieldDef {
  key: string;
  label: string;
  inputType: "text" | "number" | "password" | "url" | "toggle";
  placeholder?: string;
  options?: { value: string; label: string }[];
}

interface TypeFormDef {
  configFields: FieldDef[];
  credFields: FieldDef[];
}

const FORM_DEFS: Record<string, TypeFormDef> = {
  postgres: {
    configFields: [
      { key: "host", label: "Host", inputType: "text", placeholder: "db.example.com" },
      { key: "port", label: "Port", inputType: "number", placeholder: "5432" },
      { key: "database", label: "Database", inputType: "text", placeholder: "mydb" },
      { key: "user", label: "Username", inputType: "text", placeholder: "postgres" },
    ],
    credFields: [
      { key: "password", label: "Password", inputType: "password", placeholder: "Leave blank to keep existing" },
    ],
  },
  timescaledb: {
    configFields: [
      { key: "host", label: "Host", inputType: "text", placeholder: "db.example.com" },
      { key: "port", label: "Port", inputType: "number", placeholder: "5432" },
      { key: "database", label: "Database", inputType: "text", placeholder: "mydb" },
      { key: "user", label: "Username", inputType: "text", placeholder: "postgres" },
    ],
    credFields: [
      { key: "password", label: "Password", inputType: "password", placeholder: "Leave blank to keep existing" },
    ],
  },
  mysql: {
    configFields: [
      { key: "host", label: "Host", inputType: "text", placeholder: "db.example.com" },
      { key: "port", label: "Port", inputType: "number", placeholder: "3306" },
      { key: "database", label: "Database", inputType: "text", placeholder: "mydb" },
      { key: "user", label: "Username", inputType: "text", placeholder: "root" },
    ],
    credFields: [
      { key: "password", label: "Password", inputType: "password", placeholder: "Leave blank to keep existing" },
    ],
  },
  clickhouse: {
    configFields: [
      { key: "url", label: "URL", inputType: "url", placeholder: "https://host:8443" },
      { key: "username", label: "Username", inputType: "text", placeholder: "default" },
      { key: "database", label: "Database", inputType: "text", placeholder: "default" },
    ],
    credFields: [
      { key: "password", label: "Password", inputType: "password", placeholder: "Leave blank to keep existing" },
    ],
  },
  influxdb: {
    configFields: [
      { key: "url", label: "URL", inputType: "url", placeholder: "https://us-east-1.aws.cloud2.influxdata.com" },
      { key: "org", label: "Organization", inputType: "text", placeholder: "my-org" },
      { key: "bucket", label: "Bucket / Database", inputType: "text", placeholder: "my-bucket" },
      { key: "version", label: "Query API", inputType: "toggle", options: [{ value: "v2", label: "v2 (Flux)" }, { value: "v3", label: "v3 (SQL)" }] },
    ],
    credFields: [
      { key: "token", label: "API Token", inputType: "password", placeholder: "Leave blank to keep existing" },
    ],
  },
};

interface TestResult {
  success: boolean;
  error?: string;
}

interface EditConnectionModalProps {
  source: Source;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function EditConnectionModal({
  source,
  open,
  onOpenChange,
  onSaved,
}: EditConnectionModalProps) {
  const connectionType = source.connection_type as string;
  const formDef = FORM_DEFS[connectionType];
  const sourceConfig = (source.config as Record<string, unknown>) ?? {};

  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Pre-populate config fields from source.config when the modal opens (or
  // switches source). Done as a guarded render-time state reset (runs once per
  // open/source change) instead of an effect, which avoids a synchronous
  // setState inside an effect.
  const resetKey = open ? source.id : null;
  const [prevResetKey, setPrevResetKey] = useState<string | null>(null);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    if (open && formDef) {
      const initial: Record<string, string> = {};
      for (const field of formDef.configFields) {
        const val = sourceConfig[field.key];
        initial[field.key] = val != null ? String(val) : "";
      }
      setConfigValues(initial);
      setCredValues({});
      setTestResult(null);
    }
  }

  if (!formDef) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Connection</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Editing is not yet supported for {connectionType} connections.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  const buildPayload = () => {
    const connectionConfig: Record<string, unknown> = {};
    for (const field of formDef.configFields) {
      const val = configValues[field.key];
      if (val !== undefined && val !== "") {
        connectionConfig[field.key] = field.inputType === "number" ? Number(val) : val;
      }
    }

    const credentials: Record<string, string> = {};
    for (const field of formDef.credFields) {
      const val = credValues[field.key];
      if (val) credentials[field.key] = val;
    }

    return { connectionConfig, credentials };
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const { connectionConfig, credentials } = buildPayload();
      const res = await fetch(`/api/sources/${source.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionConfig, credentials }),
      });
      const data = await res.json();
      setTestResult({ success: data.success, error: data.error });
    } catch {
      setTestResult({ success: false, error: "Request failed" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { connectionConfig, credentials } = buildPayload();
      const res = await fetch(`/api/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionConfig, credentials }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ success: false, error: data.error || "Save failed" });
        return;
      }
      onSaved();
      onOpenChange(false);
    } catch {
      setTestResult({ success: false, error: "Request failed" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Connection</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          {formDef.configFields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`edit-${field.key}`} className="text-xs text-muted-foreground">
                {field.label}
              </Label>
              {field.inputType === "toggle" && field.options ? (
                <div className="flex gap-2">
                  {field.options.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setConfigValues((prev) => ({ ...prev, [field.key]: opt.value }))}
                      className={cn(
                        "flex-1 h-9 rounded-md border text-xs font-medium transition-colors",
                        configValues[field.key] === opt.value
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : (
                <Input
                  id={`edit-${field.key}`}
                  type={field.inputType === "number" ? "number" : "text"}
                  placeholder={field.placeholder}
                  value={configValues[field.key] ?? ""}
                  onChange={(e) =>
                    setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  className="h-9 text-xs"
                />
              )}
            </div>
          ))}

          <div className="border-t pt-3 space-y-3">
            {formDef.credFields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`edit-${field.key}`} className="text-xs text-muted-foreground">
                  {field.label}
                </Label>
                <Input
                  id={`edit-${field.key}`}
                  type="password"
                  placeholder="Leave blank to keep existing"
                  value={credValues[field.key] ?? ""}
                  onChange={(e) =>
                    setCredValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  className="h-9 text-xs"
                />
              </div>
            ))}
          </div>

          {testResult && (
            <div
              className={cn(
                "flex items-start gap-2 p-2.5 rounded text-xs",
                testResult.success
                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                  : "bg-red-500/10 text-red-600 dark:text-red-400",
              )}
            >
              {testResult.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              )}
              {testResult.success ? "Connection successful" : (testResult.error || "Connection failed")}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={isTesting || isSaving}
            className="text-xs"
          >
            {isTesting ? <><Spinner className="h-3 w-3 mr-1.5" />Testing...</> : "Test Connection"}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || isTesting}
            className="text-xs"
          >
            {isSaving ? <><Spinner className="h-3 w-3 mr-1.5" />Saving...</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
