"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { WorkerOutMessage } from "@/lib/orbital/propagation.worker";

interface SatelliteInput {
  id: string;
  tle_line1: string;
  tle_line2: string;
}

/**
 * Manages a propagation Web Worker lifecycle.
 *
 * - Creates/terminates worker when satellite list changes
 * - Exposes `positionsRef` (never triggers re-renders on update)
 * - Exposes `propagate(time)` to request new positions
 * - Exposes `ready` boolean (triggers one render when worker is initialized)
 */
export function usePropagationWorker(satellites: SatelliteInput[]) {
  const workerRef = useRef<Worker | null>(null);
  const positionsRef = useRef<Float32Array | null>(null);
  // Tracks which satellite-set (by idKey) the worker has reported ready for.
  const [readyKey, setReadyKey] = useState<string | null>(null);

  // Stable key to detect real changes in the satellite list
  const idKey = useMemo(
    () => satellites.map((s) => s.id).join(","),
    [satellites],
  );

  useEffect(() => {
    if (satellites.length === 0) {
      positionsRef.current = null;
      return;
    }

    const worker = new Worker(
      new URL("../lib/orbital/propagation.worker.ts", import.meta.url),
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      if (e.data.type === "ready") {
        setReadyKey(idKey);
      } else if (e.data.type === "positions") {
        positionsRef.current = e.data.buffer;
      }
    };

    // Send init with satellite TLE data
    worker.postMessage({
      type: "init",
      satellites: satellites.map((s) => ({
        id: s.id,
        tle_line1: s.tle_line1,
        tle_line2: s.tle_line2,
      })),
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
    // Re-create worker when the satellite list changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const propagate = useCallback((time: number) => {
    workerRef.current?.postMessage({ type: "propagate", time });
  }, []);

  // Derived: ready only when the worker has reported ready for the current
  // satellite-set. On idKey change this is false until the new worker reports
  // ready, which replaces the old synchronous reset-to-false.
  const ready = readyKey === idKey && satellites.length > 0;

  return { positionsRef, propagate, ready };
}
