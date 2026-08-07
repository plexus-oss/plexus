"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SensorInfo } from "@/hooks/use-plexus-realtime";
import { Cpu, Check, X, Settings, Gauge } from "lucide-react";

interface SensorConfigProps {
  sensors: SensorInfo[];
  isSourceOnline: boolean;
  onConfigureSensor: (sensor: string, config: Record<string, unknown>) => void;
}

export function SensorConfig({
  sensors,
  isSourceOnline,
  onConfigureSensor,
}: SensorConfigProps) {
  const [editingSensor, setEditingSensor] = useState<string | null>(null);
  const [sampleRate, setSampleRate] = useState<number>(10);

  const handleSaveSampleRate = (sensorName: string) => {
    onConfigureSensor(sensorName, { sample_rate: sampleRate });
    setEditingSensor(null);
  };

  if (sensors.length === 0) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <Cpu className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">No Sensors Detected</p>
            <p className="text-xs text-muted-foreground">
              Connect sensors to your device and restart the agent
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Sensor Configuration</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {sensors.length} sensor{sensors.length !== 1 ? "s" : ""} detected
        </span>
      </div>

      <div className="space-y-2">
        {sensors.map((sensor) => (
          <div
            key={sensor.name}
            className={`p-3 rounded-md border ${
              sensor.available
                ? "border-border bg-background"
                : "border-destructive/30 bg-destructive/5"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    sensor.available ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <div>
                  <span className="text-sm font-medium">{sensor.name}</span>
                  {sensor.description && (
                    <p className="text-xs text-muted-foreground">
                      {sensor.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {sensor.available ? (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    Online
                  </span>
                ) : (
                  <span className="text-xs text-red-600 flex items-center gap-1">
                    <X className="h-3 w-3" />
                    Unavailable
                  </span>
                )}
              </div>
            </div>

            {/* Metrics */}
            <div className="mt-2 flex flex-wrap gap-1">
              {sensor.metrics.map((metric) => (
                <span
                  key={metric}
                  className="px-2 py-0.5 text-[10px] bg-muted rounded-full"
                >
                  {sensor.prefix ? `${sensor.prefix}${metric}` : metric}
                </span>
              ))}
            </div>

            {/* Sample Rate Config */}
            <div className="mt-2 pt-2 border-t border-border">
              {editingSensor === sensor.name ? (
                <div className="flex items-center gap-2">
                  <Gauge className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Sample Rate:
                  </span>
                  <Input
                    type="number"
                    value={sampleRate}
                    onChange={(e) => setSampleRate(Number(e.target.value))}
                    className="h-6 w-20 text-xs"
                    min={1}
                    max={100}
                  />
                  <span className="text-xs text-muted-foreground">Hz</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSaveSampleRate(sensor.name)}
                    disabled={!isSourceOnline}
                    className="h-6 text-xs px-2"
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingSensor(null)}
                    className="h-6 text-xs px-2"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gauge className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Sample Rate: {sensor.sample_rate} Hz
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSampleRate(sensor.sample_rate);
                      setEditingSensor(sensor.name);
                    }}
                    disabled={!isSourceOnline || !sensor.available}
                    className="h-6 text-xs px-2"
                  >
                    Edit
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
