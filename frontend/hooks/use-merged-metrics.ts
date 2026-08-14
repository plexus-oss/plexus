"use client";

import { useMemo } from "react";
import { useAvailableMetrics } from "@/hooks/use-telemetry";
import { usePlexusRealtime } from "@/hooks/use-plexus-realtime";

/**
 * One source in the merged discovery tree: historical metrics from
 * ClickHouse unioned with live sensors/cameras from currently-online sources.
 */
export interface MergedMetricSource {
  source_id: string;
  metrics: string[];
  cameras: { camera_id: string; name?: string }[];
  isRegistered?: boolean;
  isOnline: boolean;
}

/**
 * The source → metrics discovery tree shared by the add-panel source picker
 * and the signal rail. Extracted verbatim from SourcePicker so both surfaces
 * always agree on what exists. Sorted online → registered → alphabetical.
 */
export function useMergedMetricsBySource(): {
  sources: MergedMetricSource[];
  isLoading: boolean;
} {
  const { metricsBySource, isLoading } = useAvailableMetrics();
  const { sources: realtimeSources } = usePlexusRealtime();

  const sources = useMemo(() => {
    const sourceMap = new Map<string, MergedMetricSource>();

    for (const source of metricsBySource) {
      sourceMap.set(source.source_id, {
        source_id: source.source_id,
        metrics: [...source.metrics],
        cameras: [],
        isRegistered: source.isRegistered,
        isOnline: false,
      });
    }

    for (const rtSource of realtimeSources) {
      const sourceId = rtSource.source_id;
      const existing = sourceMap.get(sourceId);
      const sensorMetrics: string[] = [];
      if (rtSource.sensors) {
        for (const sensor of rtSource.sensors) {
          if (sensor.available && sensor.metrics) {
            sensorMetrics.push(...sensor.metrics);
          }
        }
      }

      const cameras = (rtSource.cameras || []).map((cam) => ({
        camera_id: cam.camera_id,
        name: cam.name,
      }));

      if (existing) {
        const allMetrics = new Set([...existing.metrics, ...sensorMetrics]);
        existing.metrics = Array.from(allMetrics);
        existing.cameras = cameras;
        existing.isOnline = true;
      } else {
        sourceMap.set(sourceId, {
          source_id: sourceId,
          metrics: sensorMetrics,
          cameras,
          isRegistered: false,
          isOnline: true,
        });
      }
    }

    return Array.from(sourceMap.values()).sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      if (a.isRegistered !== b.isRegistered) return a.isRegistered ? -1 : 1;
      return a.source_id.localeCompare(b.source_id);
    });
  }, [metricsBySource, realtimeSources]);

  return { sources, isLoading };
}
