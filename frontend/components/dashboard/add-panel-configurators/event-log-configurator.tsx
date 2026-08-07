"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { ConfiguratorProps } from "./types";

export function EventLogConfigurator({
  draft,
  onChange,
  onValidChange,
}: ConfiguratorProps) {
  const config = draft.config as { name?: string };
  const [nameFilter, setNameFilter] = useState(config.name ?? "");

  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  const updateName = (value: string) => {
    setNameFilter(value);
    onChange({
      ...draft,
      config: { ...draft.config, name: value || undefined },
    });
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="shrink-0">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Event name filter{" "}
          <span className="normal-case text-muted-foreground/60">(optional)</span>
        </Label>
        <Input
          value={nameFilter}
          onChange={(e) => updateName(e.target.value)}
          placeholder="e.g. fault.overheat"
          className="mt-1 h-7 text-[11px]"
        />
      </div>
    </div>
  );
}
