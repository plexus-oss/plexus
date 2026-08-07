"use client";

/**
 * Conjunction Ground Track
 *
 * 2D equirectangular map showing ground tracks for two satellites
 * involved in a conjunction event. Supports both TLE-based and
 * state-vector-based propagation.
 */

import { useMemo, useState } from "react";
import { useOrbitalDevices } from "@/hooks/use-orbital-devices";
import {
  generateGroundTrack,
  propagateSGP4,
  generateGroundTrackFromStateVector,
  propagateStateVector,
  type StateVector,
} from "@/lib/orbital/propagation";
import * as satellite from "satellite.js";

/**
 * Compute the day/night terminator as a polygon path for the SVG map.
 * The terminator is the great circle 90° from the sub-solar point.
 * Returns SVG path data for the night side overlay.
 */
function computeTerminatorPath(timeMs: number): string {
  const d = new Date(timeMs);

  // Solar declination from day of year
  const dayOfYear =
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      Date.UTC(d.getUTCFullYear(), 0, 0)) /
    86400000;
  const declination =
    -23.44 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365.25);
  const decRad = (declination * Math.PI) / 180;

  // Sub-solar longitude (where it's solar noon)
  const utcHours =
    d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const subSolarLng = (((12 - utcHours) * 15 + 540) % 360) - 180;

  // For each longitude, compute the terminator latitude.
  // The terminator is where solar elevation = 0:
  //   sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(hourAngle) = 0
  //   lat = atan(-cos(hourAngle) / tan(dec))  when dec ≠ 0
  //   lat = ±90° at the poles depending on hour angle
  const toX = (lng: number) => lng + 180;
  const toY = (lat: number) => 90 - lat;

  // Sample terminator at each degree of longitude
  const terminatorLats: number[] = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    const hourAngle = ((lng - subSolarLng) * Math.PI) / 180;
    const lat =
      Math.atan(-Math.cos(hourAngle) / Math.tan(decRad)) * (180 / Math.PI);
    terminatorLats.push(lat);
  }

  // Night side polygon: terminator curve closed along map edges
  const nightIsBelow = declination >= 0;

  let path = "";
  if (nightIsBelow) {
    // Start at bottom-left corner
    path = `M 0 180`;
    // Up to the terminator at the left edge
    path += ` L 0 ${toY(terminatorLats[0]).toFixed(1)}`;
    // Along the terminator left to right
    for (let i = 1; i < terminatorLats.length; i++) {
      const lng = -180 + i * 2;
      path += ` L ${toX(lng).toFixed(1)} ${toY(terminatorLats[i]).toFixed(1)}`;
    }
    // Down to the bottom-right corner and close
    path += ` L 360 ${toY(terminatorLats[terminatorLats.length - 1]).toFixed(1)}`;
    path += ` L 360 180 Z`;
  } else {
    // Start at top-left corner
    path = `M 0 0`;
    // Down to the terminator at the left edge
    path += ` L 0 ${toY(terminatorLats[0]).toFixed(1)}`;
    // Along the terminator left to right
    for (let i = 1; i < terminatorLats.length; i++) {
      const lng = -180 + i * 2;
      path += ` L ${toX(lng).toFixed(1)} ${toY(terminatorLats[i]).toFixed(1)}`;
    }
    // Up to the top-right corner and close
    path += ` L 360 ${toY(terminatorLats[terminatorLats.length - 1]).toFixed(1)}`;
    path += ` L 360 0 Z`;
  }

  return path;
}

interface ConjunctionGroundTrackProps {
  noradIds?: string[];
  stateVectors?: Array<StateVector & { id: string; color: string }>;
  propagationTime?: number;
  eventTime?: number;
}

const SAT_COLORS = ["#f43f5e", "#3b82f6"];

export function ConjunctionGroundTrack({
  noradIds,
  stateVectors,
  propagationTime,
  eventTime,
}: ConjunctionGroundTrackProps) {
  const { orbitalDevices } = useOrbitalDevices();
  const [now] = useState(() => Date.now());
  const time = propagationTime ?? now;

  // Day/night terminator
  // Update every ~30 seconds of scrub time
  const terminatorEpoch = Math.round(time / 30000);
  const terminatorPath = useMemo(
    () => computeTerminatorPath(time),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terminatorEpoch],
  );

  // Static tracks — computed once from the event time (±1 orbit), don't move with scrub
  const trackEpoch = eventTime ?? time;
  const tracks = useMemo(() => {
    if (stateVectors && stateVectors.length > 0) {
      return stateVectors.map((sv, i) => ({
        id: sv.id,
        color: sv.color || SAT_COLORS[i % SAT_COLORS.length],
        track: generateGroundTrackFromStateVector(sv, 120, 180),
        tle: null as { line1: string; line2: string } | null,
        sv: sv as StateVector,
      }));
    }

    if (noradIds && noradIds.length > 0) {
      return noradIds.map((noradId, i) => {
        const sat = orbitalDevices.find((s) => s.norad_id === Number(noradId));
        if (!sat?.tle_line1 || !sat?.tle_line2) {
          return {
            id: noradId,
            color: SAT_COLORS[i % SAT_COLORS.length],
            track: [],
            tle: null,
            sv: null,
          };
        }
        const tle = { line1: sat.tle_line1, line2: sat.tle_line2 };
        return {
          id: noradId,
          color: sat.color || SAT_COLORS[i % SAT_COLORS.length],
          track: generateGroundTrack(tle, 120, 180, trackEpoch - 30 * 60000),
          tle,
          sv: null as StateVector | null,
        };
      });
    }

    return [];
  }, [noradIds, stateVectors, orbitalDevices, trackEpoch]);

  // Dynamic positions — move with the scrub time
  const scrubEpoch = Math.round(time / 5000);
  const satData = useMemo(() => {
    return tracks.map((t) => {
      let currentPos: { lat: number; lng: number } | null = null;

      if (t.sv) {
        const eci = propagateStateVector(t.sv, time);
        const gmst = satellite.gstime(new Date(time));
        const gd = satellite.eciToGeodetic(
          { x: eci.x, y: eci.y, z: eci.z } as satellite.EciVec3<number>,
          gmst,
        );
        currentPos = {
          lat: satellite.degreesLat(gd.latitude),
          lng: satellite.degreesLong(gd.longitude),
        };
      } else if (t.tle) {
        const result = propagateSGP4(t.tle, new Date(time));
        if (result) {
          currentPos = { lat: result.geodetic.lat, lng: result.geodetic.lng };
        }
      }

      return { id: t.id, color: t.color, track: t.track, currentPos };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, scrubEpoch]);

  const toSvg = (lat: number, lng: number) => ({
    x: lng + 180,
    y: 90 - lat,
  });

  // Split tracks at the antimeridian only (>180° longitude jump)
  const splitTrack = (track: Array<{ lat: number; lng: number }>) => {
    const segments: Array<Array<{ lat: number; lng: number }>> = [];
    if (track.length === 0) return segments;
    let current = [track[0]];
    for (let i = 1; i < track.length; i++) {
      if (Math.abs(track[i].lng - track[i - 1].lng) > 180) {
        segments.push(current);
        current = [track[i]];
      } else {
        current.push(track[i]);
      }
    }
    segments.push(current);
    return segments;
  };

  return (
    <div>
      <div className="relative rounded overflow-hidden">
        {/* Earth texture background: decorative, full-width CSS-sized backdrop
            behind an absolute SVG overlay; next/image fill would collapse the
            unsized container, so keep a plain img. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/day.webp"
          alt=""
          className="w-full block"
          draggable={false}
          style={{ filter: "brightness(0.7) saturate(0.6)" }}
        />
        {/* SVG overlay for terminator + tracks */}
        <svg
          viewBox="0 0 360 180"
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="none"
        >
          {/* Day/night terminator with soft edge */}
          <defs>
            <filter id="terminator-blur">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <path
            d={terminatorPath}
            fill="black"
            opacity="0.5"
            filter="url(#terminator-blur)"
          />

          {/* Ground tracks + current positions */}
          {satData.map((sat) => (
            <g key={sat.id}>
              {splitTrack(sat.track).map((seg, si) => (
                <polyline
                  key={si}
                  points={seg
                    .map((p) => {
                      const s = toSvg(p.lat, p.lng);
                      return `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
                    })
                    .join(" ")}
                  fill="none"
                  stroke={sat.color}
                  strokeWidth="0.75"
                  strokeLinecap="round"
                  opacity="0.8"
                />
              ))}
              {sat.currentPos && (
                <>
                  <circle
                    cx={toSvg(sat.currentPos.lat, sat.currentPos.lng).x}
                    cy={toSvg(sat.currentPos.lat, sat.currentPos.lng).y}
                    r="4"
                    fill={sat.color}
                    opacity="0.2"
                  />
                  <circle
                    cx={toSvg(sat.currentPos.lat, sat.currentPos.lng).x}
                    cy={toSvg(sat.currentPos.lat, sat.currentPos.lng).y}
                    r="2"
                    fill={sat.color}
                  />
                </>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
        <span>180°W</span>
        <span>0°</span>
        <span>180°E</span>
      </div>
    </div>
  );
}
