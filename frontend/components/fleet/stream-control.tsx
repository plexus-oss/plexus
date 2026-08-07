"use client";

import { useState, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";

interface StreamControlProps {
  sourceId: string;
  isSourceOnline: boolean;
  isRecording: boolean;
  onSetRecording: (store: boolean) => void;
  /** Called when recording preference changes - save to database */
  onSavePreference?: (store: boolean) => Promise<void>;
  /** Disable the toggle */
  disabled?: boolean;
}

export function StreamControl({
  isSourceOnline,
  isRecording,
  onSetRecording,
  onSavePreference,
  disabled,
}: StreamControlProps) {
  const [isSaving, setIsSaving] = useState(false);

  const handleRecordingToggle = useCallback(
    async (checked: boolean) => {
      onSetRecording(checked);

      if (onSavePreference) {
        setIsSaving(true);
        try {
          await onSavePreference(checked);
        } catch (error) {
          console.error("Failed to save recording preference:", error);
        } finally {
          setIsSaving(false);
        }
      }
    },
    [onSetRecording, onSavePreference],
  );

  if (!isSourceOnline) {
    return (
      <div className="py-2 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium text-muted-foreground">
              Record
            </Label>
            <p className="text-xs text-muted-foreground">Device offline</p>
          </div>
          <Switch checked={isRecording} disabled />
        </div>
        <p className="text-[10px] text-muted-foreground/70">
          Recording will resume automatically when the device reconnects
        </p>
      </div>
    );
  }

  return (
    <div className="py-2 space-y-1">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Record</Label>
          <p className="text-xs text-muted-foreground">
            {disabled
              ? "Upgrade to record data"
              : isRecording
                ? "Storing to Plexus"
                : "Live only — data is not saved"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSaving && <Spinner className="h-3 w-3 text-muted-foreground" />}
          <Switch
            checked={isRecording}
            onCheckedChange={handleRecordingToggle}
            disabled={isSaving || disabled}
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground/70">
        {isRecording
          ? "Incoming data is saved for dashboards and historical analysis"
          : "You can view real-time data, but nothing is stored"}
      </p>
    </div>
  );
}
