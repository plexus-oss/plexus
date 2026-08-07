/**
 * Shared Orbital Mechanics Module
 *
 * All orbital propagation, TLE parsing, and coordinate transforms.
 * Uses ECI coordinates internally; converts to Three.js scene coords only at render time.
 */

import * as satellite from "satellite.js";
import * as THREE from "three";
import { EARTH_RADIUS_KM, SCENE_SCALE } from "@/lib/constants/earth";

// ─── TLE Parsing ────────────────────────────────────────────────────────────

/** Parse the epoch from TLE line 1 (chars 18-32: 2-digit year + fractional day) */
export function getTleEpoch(tleLine1: string): Date {
  const epochStr = tleLine1.substring(18, 32).trim();
  const year2 = parseInt(epochStr.substring(0, 2), 10);
  const dayFraction = parseFloat(epochStr.substring(2));

  // Two-digit year: 57-99 → 1957-1999, 00-56 → 2000-2056
  const year = year2 >= 57 ? 1900 + year2 : 2000 + year2;

  const epoch = new Date(Date.UTC(year, 0, 1));
  epoch.setTime(epoch.getTime() + (dayFraction - 1) * 86400000);
  return epoch;
}

/** Check if a TLE is stale (epoch older than maxAgeDays from now) */
export function isTleStale(tleLine1: string, maxAgeDays: number = 14): boolean {
  try {
    const epoch = getTleEpoch(tleLine1);
    const ageDays = (Date.now() - epoch.getTime()) / 86400000;
    return ageDays > maxAgeDays;
  } catch {
    return true;
  }
}

/** Convert radians to degrees (unclamped — works for any orbital angle) */
function rad2deg(rad: number): number {
  return rad * (180 / Math.PI);
}

/** Extract orbital elements from TLE lines */
export function getOrbitalElements(tleLine1: string, tleLine2: string) {
  const satrec = satellite.twoline2satrec(tleLine1, tleLine2);

  // Mean motion in rad/min → rev/day
  const meanMotionRevPerDay = satrec.no * (1440 / (2 * Math.PI));
  const periodMinutes = 1440 / meanMotionRevPerDay;

  // Semi-major axis from period (Kepler's 3rd law)
  const mu = 398600.4418; // km^3/s^2
  const periodSeconds = periodMinutes * 60;
  const semiMajorAxis = Math.pow(
    (mu * periodSeconds * periodSeconds) / (4 * Math.PI * Math.PI),
    1 / 3,
  );
  const altitudeKm = semiMajorAxis - 6371;

  const ecc = satrec.ecco;
  const apogeeAlt = semiMajorAxis * (1 + ecc) - 6371;
  const perigeeAlt = semiMajorAxis * (1 - ecc) - 6371;

  const inc = satellite.degreesLat(satrec.inclo);
  const raanDeg = rad2deg(satrec.nodeo);
  const argPerigeeDeg = rad2deg(satrec.argpo);

  return {
    inclination: inc,
    eccentricity: ecc,
    raan: raanDeg,
    argPerigee: argPerigeeDeg,
    meanAnomaly: rad2deg(satrec.mo),
    meanMotion: meanMotionRevPerDay,
    period: periodMinutes,
    altitude: altitudeKm,
    semiMajorAxis,
    apogeeAlt,
    perigeeAlt,
    bstar: satrec.bstar,
  };
}

/** Generate a key that identifies the orbit shape + plane.
 *  Satellites in the same constellation slot (e.g. Starlink shell)
 *  share nearly identical elements — rounding absorbs small perturbation deltas. */
export function orbitKey(tleLine1: string, tleLine2: string): string {
  try {
    const el = getOrbitalElements(tleLine1, tleLine2);
    const mm = el.meanMotion.toFixed(1);
    const inc = el.inclination.toFixed(0);
    const ecc = el.eccentricity.toFixed(3);
    const raan = (Math.round(el.raan / 5) * 5).toString(); // 5° buckets
    return `${mm}|${inc}|${ecc}|${raan}`;
  } catch {
    return Math.random().toString(); // fallback: unique key = always render
  }
}

// ─── SGP4 Propagation ───────────────────────────────────────────────────────

export interface PropagationResult {
  position: THREE.Vector3;
  positionEci: { x: number; y: number; z: number };
  geodetic: { lat: number; lng: number; alt: number };
  velocity: THREE.Vector3;
}

/** Propagate satellite position using SGP4. Returns ECEF scene coords via geodetic conversion. */
export function propagateSGP4(
  tle: { line1: string; line2: string },
  date: Date,
): PropagationResult | null {
  try {
    const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    const pv = satellite.propagate(satrec, date);

    if (!pv || !pv.position || typeof pv.position === "boolean") return null;

    const posEci = pv.position as satellite.EciVec3<number>;
    const velEci = (pv.velocity || {
      x: 0,
      y: 0,
      z: 0,
    }) as satellite.EciVec3<number>;

    // Geodetic for reference
    const gmst = satellite.gstime(date);
    const gd = satellite.eciToGeodetic(posEci, gmst);

    // Geodetic → scene coordinates via latLngAltToPosition (ECEF, Earth-fixed)
    const lat = satellite.degreesLat(gd.latitude);
    const lng = satellite.degreesLong(gd.longitude);
    const alt = gd.height;

    return {
      position: latLngAltToPosition(lat, lng, alt),
      positionEci: { x: posEci.x, y: posEci.y, z: posEci.z },
      geodetic: { lat, lng, alt },
      velocity: new THREE.Vector3(velEci.x, velEci.z, velEci.y),
    };
  } catch (err) {
    console.warn("[SGP4] Propagation failed:", err);
    return null;
  }
}

// ─── Path Generation ────────────────────────────────────────────────────────

/** Generate a full orbital path as a closed ring in ECI scene-space.
 *  Propagates SGP4 over one full orbital period from the current time
 *  so the path always matches the live satellite position (accounts for
 *  J2 RAAN precession, drag, and all SGP4 perturbations).
 *  Points are in the inertial frame — the renderer must rotate them
 *  by -GMST around Y each frame to align with the ECEF globe. */
export function generateOrbitalPath(
  tle: { line1: string; line2: string },
  segments: number = 120,
  epochMs?: number,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  try {
    const satrec = satellite.twoline2satrec(tle.line1, tle.line2);

    // Orbital period from mean motion
    const mmRevDay = satrec.no * (1440 / (2 * Math.PI));
    const periodMs = (86400 / mmRevDay) * 1000;

    const startTime = epochMs ?? Date.now();

    for (let i = 0; i < segments; i++) {
      const t = new Date(startTime + (i / segments) * periodMs);
      const pv = satellite.propagate(satrec, t);

      if (!pv || !pv.position || typeof pv.position === "boolean") continue;

      const posEci = pv.position as satellite.EciVec3<number>;
      points.push(
        eciToScenePosition({ x: posEci.x, y: posEci.y, z: posEci.z }),
      );
    }
  } catch (err) {
    console.warn("[SGP4] Orbital path generation failed:", err);
  }
  return points;
}

export function generateGroundTrack(
  tle: { line1: string; line2: string },
  durationMinutes: number = 90,
  segments: number = 120,
  epochMs?: number,
): Array<{ lat: number; lng: number }> {
  const track: Array<{ lat: number; lng: number }> = [];
  try {
    const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    const startTime = epochMs ?? Date.now();

    for (let i = 0; i <= segments; i++) {
      const offsetMin = (i / segments) * durationMinutes;
      const d = new Date(startTime + offsetMin * 60000);
      const pv = satellite.propagate(satrec, d);

      if (!pv || !pv.position || typeof pv.position === "boolean") continue;

      const p = pv.position as satellite.EciVec3<number>;
      const gmst = satellite.gstime(d);
      const gd = satellite.eciToGeodetic(p, gmst);

      track.push({
        lat: satellite.degreesLat(gd.latitude),
        lng: satellite.degreesLong(gd.longitude),
      });
    }
  } catch {
    // empty
  }
  return track;
}

// ─── Fallback Keplerian Mechanics (no TLE) ──────────────────────────────────

/** Calculate position from basic orbital elements (fallback when no TLE) */
export function calculateKeplerianPosition(
  elapsedMs: number,
  orbitalPeriod: number, // minutes
  inclination: number,
  raan: number,
  initialPhase: number,
): THREE.Vector3 {
  const periodMs = orbitalPeriod * 60_000; // convert minutes → milliseconds
  const phase = ((elapsedMs / periodMs) * 360 + initialPhase) % 360;
  const angle = (phase * Math.PI) / 180;
  const incRad = (inclination * Math.PI) / 180;
  const raanRad = (raan * Math.PI) / 180;

  const altitude = 550;
  const radius = (EARTH_RADIUS_KM + altitude) * SCENE_SCALE;

  const x0 = radius * Math.cos(angle);
  const z0 = radius * Math.sin(angle);

  const x1 = x0;
  const y1 = -z0 * Math.sin(incRad);
  const z1 = z0 * Math.cos(incRad);

  const x2 = x1 * Math.cos(raanRad) + z1 * Math.sin(raanRad);
  const y2 = y1;
  const z2 = -x1 * Math.sin(raanRad) + z1 * Math.cos(raanRad);

  return new THREE.Vector3(x2, y2, z2);
}

/** Generate Keplerian orbital ring (fallback when no TLE) */
export function generateKeplerianPath(
  inclination: number,
  raan: number,
  segments: number = 120,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const incRad = (inclination * Math.PI) / 180;
  const raanRad = (raan * Math.PI) / 180;
  const altitude = 550;
  const radius = (EARTH_RADIUS_KM + altitude) * SCENE_SCALE;

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;

    const x0 = radius * Math.cos(angle);
    const z0 = radius * Math.sin(angle);

    const x1 = x0;
    const y1 = -z0 * Math.sin(incRad);
    const z1 = z0 * Math.cos(incRad);

    const x2 = x1 * Math.cos(raanRad) + z1 * Math.sin(raanRad);
    const y2 = y1;
    const z2 = -x1 * Math.sin(raanRad) + z1 * Math.cos(raanRad);

    points.push(new THREE.Vector3(x2, y2, z2));
  }
  return points;
}

// ─── Scene Coordinate Helpers ───────────────────────────────────────────────

/** Convert geodetic (lat/lng/alt) to Three.js scene position.
 *  Uses true 1:1000 scale — no altitude exaggeration. */
export function latLngAltToPosition(
  lat: number,
  lng: number,
  altitudeKm: number,
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const radius = (EARTH_RADIUS_KM + altitudeKm) * SCENE_SCALE;

  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** Convert ECI coordinates (km) to Three.js scene position.
 *  Uses true 1:1000 scale — no altitude exaggeration.
 *  Returns coordinates in the ECI frame — must be rotated by -GMST around Y to get ECEF. */
export function eciToScenePosition(eci: {
  x: number;
  y: number;
  z: number;
}): THREE.Vector3 {
  // ECI axes: x,y equatorial, z north → Scene axes: x,z equatorial, y north
  return new THREE.Vector3(
    eci.x * SCENE_SCALE,
    eci.z * SCENE_SCALE,
    -eci.y * SCENE_SCALE,
  );
}

// ─── Two-Body State Vector Propagation ─────────────────────────────────────

const GM_EARTH = 398600.4418; // Earth gravitational parameter, km³/s²

export interface StateVector {
  /** Position in ECI, km */
  x: number;
  y: number;
  z: number;
  /** Velocity in ECI, km/s */
  vx: number;
  vy: number;
  vz: number;
  /** Epoch of this state vector, ms since Unix epoch */
  epoch: number;
}

/**
 * Propagate a state vector forward/backward using two-body (Keplerian) dynamics.
 * Uses 4th-order Runge-Kutta integration. More accurate than SGP4/TLE for short
 * time spans around a known epoch (e.g. conjunction events with user-provided
 * state vectors).
 *
 * Returns the ECI position at the target time.
 */
export function propagateStateVector(
  sv: StateVector,
  targetTimeMs: number,
): { x: number; y: number; z: number } {
  const dt = (targetTimeMs - sv.epoch) / 1000; // seconds

  // For very small dt, skip integration
  if (Math.abs(dt) < 0.001) {
    return { x: sv.x, y: sv.y, z: sv.z };
  }

  // RK4 integration
  const step = dt > 0 ? Math.min(dt, 10) : Math.max(dt, -10); // 10s max step
  const steps = Math.ceil(Math.abs(dt / step));
  const h = dt / steps;

  let rx = sv.x,
    ry = sv.y,
    rz = sv.z;
  let vx = sv.vx,
    vy = sv.vy,
    vz = sv.vz;

  for (let i = 0; i < steps; i++) {
    // Acceleration function: a = -GM * r / |r|³
    const accel = (px: number, py: number, pz: number) => {
      const r = Math.sqrt(px * px + py * py + pz * pz);
      const r3 = r * r * r;
      return { ax: (-GM_EARTH * px) / r3, ay: (-GM_EARTH * py) / r3, az: (-GM_EARTH * pz) / r3 };
    };

    // k1
    const a1 = accel(rx, ry, rz);
    const k1rx = vx, k1ry = vy, k1rz = vz;
    const k1vx = a1.ax, k1vy = a1.ay, k1vz = a1.az;

    // k2
    const a2 = accel(rx + k1rx * h / 2, ry + k1ry * h / 2, rz + k1rz * h / 2);
    const k2rx = vx + k1vx * h / 2, k2ry = vy + k1vy * h / 2, k2rz = vz + k1vz * h / 2;
    const k2vx = a2.ax, k2vy = a2.ay, k2vz = a2.az;

    // k3
    const a3 = accel(rx + k2rx * h / 2, ry + k2ry * h / 2, rz + k2rz * h / 2);
    const k3rx = vx + k2vx * h / 2, k3ry = vy + k2vy * h / 2, k3rz = vz + k2vz * h / 2;
    const k3vx = a3.ax, k3vy = a3.ay, k3vz = a3.az;

    // k4
    const a4 = accel(rx + k3rx * h, ry + k3ry * h, rz + k3rz * h);
    const k4rx = vx + k3vx * h, k4ry = vy + k3vy * h, k4rz = vz + k3vz * h;
    const k4vx = a4.ax, k4vy = a4.ay, k4vz = a4.az;

    // Update
    rx += (h / 6) * (k1rx + 2 * k2rx + 2 * k3rx + k4rx);
    ry += (h / 6) * (k1ry + 2 * k2ry + 2 * k3ry + k4ry);
    rz += (h / 6) * (k1rz + 2 * k2rz + 2 * k3rz + k4rz);
    vx += (h / 6) * (k1vx + 2 * k2vx + 2 * k3vx + k4vx);
    vy += (h / 6) * (k1vy + 2 * k2vy + 2 * k3vy + k4vy);
    vz += (h / 6) * (k1vz + 2 * k2vz + 2 * k3vz + k4vz);
  }

  return { x: rx, y: ry, z: rz };
}

/**
 * Generate an orbital path from a state vector by propagating over one full orbit.
 * Returns points in ECI scene-space — must be rendered inside a GMST-rotated group.
 */
export function generateOrbitalPathFromStateVector(
  sv: StateVector,
  segments: number = 120,
): THREE.Vector3[] {
  // Compute orbital period from state vector
  const r = Math.sqrt(sv.x * sv.x + sv.y * sv.y + sv.z * sv.z);
  const v = Math.sqrt(sv.vx * sv.vx + sv.vy * sv.vy + sv.vz * sv.vz);
  const semiMajorAxis = 1 / (2 / r - (v * v) / GM_EARTH);
  const periodMs = 2 * Math.PI * Math.sqrt(Math.pow(semiMajorAxis, 3) / GM_EARTH) * 1000;

  const points: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const t = sv.epoch + (i / segments) * periodMs;
    const pos = propagateStateVector(sv, t);
    points.push(eciToScenePosition(pos));
  }
  return points;
}

/**
 * Propagate a state vector and return scene-space position (ECEF via geodetic).
 * Same output format as propagateSGP4 for use in satellite markers.
 */
export function propagateStateVectorToScene(
  sv: StateVector,
  targetTimeMs: number,
): THREE.Vector3 {
  const eci = propagateStateVector(sv, targetTimeMs);
  // Convert ECI → geodetic → ECEF scene position (same as propagateSGP4)
  const gmst = satellite.gstime(new Date(targetTimeMs));
  const posEci = { x: eci.x, y: eci.y, z: eci.z } as satellite.EciVec3<number>;
  const gd = satellite.eciToGeodetic(posEci, gmst);
  const lat = satellite.degreesLat(gd.latitude);
  const lng = satellite.degreesLong(gd.longitude);
  const alt = gd.height;
  return latLngAltToPosition(lat, lng, alt);
}

/**
 * Generate a ground track from a state vector.
 * Returns lat/lng pairs projected onto the earth's surface.
 */
export function generateGroundTrackFromStateVector(
  sv: StateVector,
  durationMinutes: number = 90,
  segments: number = 120,
): Array<{ lat: number; lng: number }> {
  const track: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i <= segments; i++) {
    const t = sv.epoch + (i / segments) * durationMinutes * 60000;
    const eci = propagateStateVector(sv, t);
    const gmst = satellite.gstime(new Date(t));
    const posEci = { x: eci.x, y: eci.y, z: eci.z } as satellite.EciVec3<number>;
    const gd = satellite.eciToGeodetic(posEci, gmst);
    track.push({
      lat: satellite.degreesLat(gd.latitude),
      lng: satellite.degreesLong(gd.longitude),
    });
  }
  return track;
}
