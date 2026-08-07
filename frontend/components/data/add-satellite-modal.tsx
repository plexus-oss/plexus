"use client";

/**
 * Add Satellite Modal
 *
 * Lookup satellite by NORAD ID or name, preview orbital params, then add to catalog.
 */

import { useState } from "react";
import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { lookupTle } from "@/lib/tle/lookup";
import type { TleLookupResult } from "@/lib/types/tle";
import { useSources } from "@/hooks/use-sources";

const COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#ef4444", // red
  "#f97316", // orange
];

interface AddSatelliteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSatelliteModal({
  open,
  onOpenChange,
}: AddSatelliteModalProps) {
  const { createSource } = useSources();
  const [query, setQuery] = useState("");
  const [lookupResult, setLookupResult] = useState<TleLookupResult | null>(
    null,
  );
  const [isLooking, setIsLooking] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [nameOverride, setNameOverride] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [groupName, setGroupName] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);

  const handleLookup = async () => {
    if (!query.trim()) return;
    setIsLooking(true);
    setLookupError(null);
    setLookupResult(null);

    try {
      const isNumeric = /^\d+$/.test(query.trim());
      const result = await lookupTle(
        isNumeric
          ? { norad_id: parseInt(query.trim(), 10) }
          : { name: query.trim() },
      );
      setLookupResult(result);
      setNameOverride("");
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setIsLooking(false);
    }
  };

  const handleAdd = async () => {
    if (!lookupResult) return;
    setIsAdding(true);

    try {
      const satName = nameOverride || lookupResult.name;
      await createSource({
        source_type: "device",
        slug: `sat-${lookupResult.norad_id}`,
        name: satName,
        device_type: "satellite",
        metadata: {
          norad_id: lookupResult.norad_id,
          official_name: lookupResult.name,
          color,
          group_name: groupName || null,
          tle_line1: lookupResult.tle_line1,
          tle_line2: lookupResult.tle_line2,
          tle_epoch: lookupResult.tle_epoch,
          tle_fetched_at: new Date().toISOString(),
        },
      });

      // Reset and close
      setQuery("");
      setLookupResult(null);
      setNameOverride("");
      setGroupName("");
      setColor(COLORS[0]);
      onOpenChange(false);
    } catch {
      // Error toast is shown by the hook
    } finally {
      setIsAdding(false);
    }
  };

  const reset = () => {
    setQuery("");
    setLookupResult(null);
    setLookupError(null);
    setNameOverride("");
    setGroupName("");
    setColor(COLORS[0]);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Satellite</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Lookup field */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              NORAD Catalog ID or Satellite Name
            </Label>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                placeholder="e.g. 25544 or ISS"
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                className="h-8 px-3"
                onClick={handleLookup}
                disabled={isLooking || !query.trim()}
              >
                {isLooking ? (
                  <Spinner variant="button" className="h-3.5 w-3.5" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            {lookupError && (
              <p className="text-[11px] text-destructive">{lookupError}</p>
            )}
          </div>

          {/* Preview */}
          {lookupResult && (
            <div className="space-y-3 border border-border rounded-md p-3">
              <div>
                <p className="text-xs font-medium">{lookupResult.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  NORAD {lookupResult.norad_id}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <span className="text-muted-foreground">Inclination</span>
                <span>
                  {lookupResult.orbital_params.inclination.toFixed(2)}&deg;
                </span>
                <span className="text-muted-foreground">Altitude</span>
                <span>
                  {lookupResult.orbital_params.altitude.toFixed(0)} km
                </span>
                <span className="text-muted-foreground">Period</span>
                <span>{lookupResult.orbital_params.period.toFixed(1)} min</span>
                <span className="text-muted-foreground">Eccentricity</span>
                <span>
                  {lookupResult.orbital_params.eccentricity.toFixed(5)}
                </span>
              </div>

              {/* Name override */}
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">
                  Display Name (optional)
                </Label>
                <Input
                  value={nameOverride}
                  onChange={(e) => setNameOverride(e.target.value)}
                  placeholder={lookupResult.name}
                  className="h-7 text-xs"
                />
              </div>

              {/* Group */}
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">
                  Group (optional)
                </Label>
                <Input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g. Constellation A"
                  className="h-7 text-xs"
                />
              </div>

              {/* Color */}
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">
                  Color
                </Label>
                <div className="flex gap-1.5">
                  {COLORS.map((c) => (
                    <Button
                      key={c}
                      variant="ghost"
                      size="icon"
                      onClick={() => setColor(c)}
                      className={`w-5 h-5 rounded-full p-0 hover:bg-transparent ${
                        color === c
                          ? "ring-2 ring-offset-1 ring-offset-background ring-foreground/30 scale-110"
                          : ""
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Add button */}
              <Button
                className="w-full h-8 text-xs"
                onClick={handleAdd}
                disabled={isAdding}
              >
                {isAdding ? (
                  <Spinner variant="button" className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                )}
                Add Satellite
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
