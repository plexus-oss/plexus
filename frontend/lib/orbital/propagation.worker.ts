/**
 * SGP4 Propagation Web Worker
 *
 * Moves all satellite propagation off the main thread.
 * Receives TLE data, propagates positions via SGP4, and returns
 * a Float32Array of scene-space positions via Transferable.
 *
 * No React, no THREE, no @/ aliases — must be self-contained for webpack bundling.
 */

import * as satellite from "satellite.js";

// Keep in sync with components/earth.tsx
const EARTH_RADIUS_KM = 6371;
const SCENE_SCALE = 0.001;
const EARTH_RADIUS = EARTH_RADIUS_KM * SCENE_SCALE;
const ALTITUDE_EXAGGERATION = 1;

// ─── State ──────────────────────────────────────────────────────────────────

type SatRec = ReturnType<typeof satellite.twoline2satrec>;

let satrecs: (SatRec | null)[] = [];
let count = 0;
let buffer: Float32Array = new Float32Array(0);

// ─── Message Handlers ───────────────────────────────────────────────────────

export type WorkerInMessage =
  | {
      type: "init";
      satellites: { id: string; tle_line1: string; tle_line2: string }[];
    }
  | { type: "propagate"; time: number };

export type WorkerOutMessage =
  | { type: "ready" }
  | { type: "positions"; buffer: Float32Array };

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === "init") {
    count = msg.satellites.length;
    buffer = new Float32Array(count * 3);
    satrecs = msg.satellites.map((s) => {
      try {
        return satellite.twoline2satrec(s.tle_line1, s.tle_line2);
      } catch {
        return null;
      }
    });
    (self as unknown as Worker).postMessage({
      type: "ready",
    } satisfies WorkerOutMessage);
    return;
  }

  if (msg.type === "propagate") {
    const date = new Date(msg.time);

    for (let i = 0; i < count; i++) {
      const rec = satrecs[i];
      if (!rec) continue;

      try {
        const pv = satellite.propagate(rec, date);
        if (!pv || !pv.position || typeof pv.position === "boolean") continue;

        const p = pv.position as { x: number; y: number; z: number };

        // ECI → geodetic → scene (ECEF, Earth-fixed)
        const gmst = satellite.gstime(date);
        const gd = satellite.eciToGeodetic(
          p as satellite.EciVec3<number>,
          gmst,
        );
        // gd.latitude/longitude in radians, gd.height in km
        const phi = Math.PI / 2 - gd.latitude; // colatitude
        const theta = gd.longitude + Math.PI; // match Three.js UV convention
        const altScale = gd.height / EARTH_RADIUS_KM;
        const radius =
          EARTH_RADIUS * (1 + altScale * ALTITUDE_EXAGGERATION);

        const idx = i * 3;
        buffer[idx] = -radius * Math.sin(phi) * Math.cos(theta);
        buffer[idx + 1] = radius * Math.cos(phi);
        buffer[idx + 2] = radius * Math.sin(phi) * Math.sin(theta);
      } catch {
        // skip failed propagations — position stays at last known value
      }
    }

    // Copy buffer before transfer so worker retains its working copy
    const copy = new Float32Array(buffer);
    (self as unknown as Worker).postMessage(
      { type: "positions", buffer: copy } satisfies WorkerOutMessage,
      [copy.buffer] as unknown as Transferable[],
    );
  }
};
