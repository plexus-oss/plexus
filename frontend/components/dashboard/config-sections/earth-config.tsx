"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useOrbitalDevices } from "@/hooks/use-orbital-devices";

interface Props {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
  metrics?: string[];
}

export function EarthConfig({ config, onChange }: Props) {
  const { orbitalDevices } = useOrbitalDevices();
  const selectedIds = (config.deviceIds as string[]) || [];
  const selectedGroups = (config.deviceGroups as string[]) || [];

  const groups = useMemo(() => {
    const names = new Set<string>();
    for (const s of orbitalDevices) {
      if (s.group_name) names.add(s.group_name);
    }
    return Array.from(names).sort();
  }, [orbitalDevices]);

  const toggleSatellite = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onChange({ deviceIds: next });
  };

  const toggleGroup = (group: string) => {
    const next = selectedGroups.includes(group)
      ? selectedGroups.filter((g) => g !== group)
      : [...selectedGroups, group];
    onChange({ deviceGroups: next });
  };

  return (
    <div className="px-3 py-2 border-b border-border space-y-2">
      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Satellites
      </Label>

      {orbitalDevices.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No satellites in catalog. Add satellites from the{" "}
          <a href="/data" className="text-primary underline">
            Data page
          </a>
          .
        </p>
      ) : (
        <>
          {groups.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Groups</span>
              {groups.map((group) => (
                <Label key={group} className="flex items-center gap-2 text-[11px]">
                  <Checkbox
                    checked={selectedGroups.includes(group)}
                    onCheckedChange={() => toggleGroup(group)}
                    className="h-3 w-3"
                  />
                  {group}
                </Label>
              ))}
            </div>
          )}

          <div className="space-y-1 max-h-40 overflow-y-auto">
            <span className="text-[10px] text-muted-foreground">Individual</span>
            {orbitalDevices.map((sat) => (
              <Label key={sat.id} className="flex items-center gap-2 text-[11px]">
                <Checkbox
                  checked={selectedIds.includes(sat.id)}
                  onCheckedChange={() => toggleSatellite(sat.id)}
                  className="h-3 w-3"
                />
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: sat.color }}
                />
                <span className="truncate">{sat.name}</span>
                {!sat.tle_line1 && (
                  <span className="ml-auto text-[9px] text-amber-500 shrink-0">
                    No TLE
                  </span>
                )}
              </Label>
            ))}
          </div>
        </>
      )}

      <div className="space-y-1 pt-1">
        <span className="text-[10px] text-muted-foreground">Display</span>
        <Label className="flex items-center gap-2 text-[11px]">
          <Checkbox
            checked={(config.showOrbitalPaths as boolean) ?? true}
            onCheckedChange={(checked) => onChange({ showOrbitalPaths: checked === true })}
            className="h-3 w-3"
          />
          Orbital paths
        </Label>
        <Label className="flex items-center gap-2 text-[11px]">
          <Checkbox
            checked={(config.showAtmosphere as boolean) ?? true}
            onCheckedChange={(checked) => onChange({ showAtmosphere: checked === true })}
            className="h-3 w-3"
          />
          Atmosphere
        </Label>
        <Label className="flex items-center gap-2 text-[11px]">
          <Checkbox
            checked={(config.showClouds as boolean) ?? false}
            onCheckedChange={(checked) => onChange({ showClouds: checked === true })}
            className="h-3 w-3"
          />
          Clouds
        </Label>
        <Label className="flex items-center gap-2 text-[11px]">
          <Checkbox
            checked={(config.showSunLighting as boolean) ?? false}
            onCheckedChange={(checked) => onChange({ showSunLighting: checked === true })}
            className="h-3 w-3"
          />
          Sun lighting
        </Label>
      </div>
    </div>
  );
}
