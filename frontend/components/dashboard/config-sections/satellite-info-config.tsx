"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOrbitalDevices } from "@/hooks/use-orbital-devices";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function SatelliteInfoConfig({ config, onChange }: Props) {
  const { orbitalDevices } = useOrbitalDevices();
  const currentSourceId = config.sourceId as string | undefined;

  if (config.connectionId && config.tleQuery) {
    return (
      <div className="px-3 py-2 border-b border-border space-y-2">
        <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Satellite Source
        </Label>
        <p className="text-[11px] text-muted-foreground">
          Using dashboard variable <code className="text-[10px] bg-muted px-1 rounded">$sat_id</code> from linked connection
        </p>
        {orbitalDevices.length > 0 && (
          <>
            <span className="text-[10px] text-muted-foreground">Or select a device:</span>
            <Select
              value={currentSourceId || "__connection__"}
              onValueChange={(v) => {
                if (v === "__connection__") {
                  onChange({ sourceId: undefined });
                } else {
                  onChange({ sourceId: v });
                }
              }}
            >
              <SelectTrigger className="h-7 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__connection__" className="text-xs">
                  From connection ($sat_id)
                </SelectItem>
                {orbitalDevices.map((sat) => (
                  <SelectItem key={sat.id} value={sat.id} className="text-xs">
                    {sat.name} {sat.norad_id ? `(${sat.norad_id})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-b border-border space-y-2">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Satellite
      </Label>
      {orbitalDevices.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No satellite devices found</p>
      ) : (
        <Select
          value={currentSourceId || ""}
          onValueChange={(v) => onChange({ sourceId: v })}
        >
          <SelectTrigger className="h-7 text-[12px]">
            <SelectValue placeholder="Select satellite..." />
          </SelectTrigger>
          <SelectContent>
            {orbitalDevices.map((sat) => (
              <SelectItem key={sat.id} value={sat.id} className="text-xs">
                {sat.name} {sat.norad_id ? `(${sat.norad_id})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
