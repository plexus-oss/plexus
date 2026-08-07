"use client";

/**
 * Callouts3DOverlay — floating value chips anchored to named meshes.
 *
 * The chip sits at `meshPos + offset` (screen px). As the user orbits
 * the camera, the mesh's projected position changes and the chip moves
 * with it. Offsets are kept tight (~50–90 px) so the relationship
 * between chip and mesh is obvious at a glance.
 *
 * Why screen-space (vs. 3D Html overlay or fixed slots):
 *   - Leader lines stay crisp via SVG at any DPR.
 *   - Compact Callout (no extras row) avoids overlap when meshes cluster.
 */

import { useMemo } from "react";
import type { TelemetryBinding } from "@/lib/types/dashboard";
import {
  SCHEMATIC_THEME,
  thresholdFor,
  type ThresholdState,
} from "@/lib/schematic/theme";
import { Callout, type CalloutExtras } from "../schematic/callout";

interface Callouts3DOverlayProps {
  bindings: TelemetryBinding[];
  values: Record<string, number | string | null>;
  positions: Record<string, { x: number; y: number; depth: number }>;
  extras?: Record<string, CalloutExtras>;
  units?: Record<string, string>;
  showLeaderLines?: boolean;
}

export function Callouts3DOverlay({
  bindings,
  values,
  extras,
  positions,
  units,
  showLeaderLines = true,
}: Callouts3DOverlayProps) {
  const placed = useMemo(() => {
    return bindings
      .filter((b) => b.anchor.kind === "mesh-name")
      .map((b) => {
        const meshName =
          b.anchor.kind === "mesh-name" ? b.anchor.name : null;
        if (!meshName) return null;
        const pos = positions[meshName];
        if (!pos) return null;
        const offset = b.calloutOffset ?? SCHEMATIC_THEME.callout.defaultOffset;
        const v = values[b.metric];
        const state: ThresholdState =
          typeof v === "number"
            ? thresholdFor(v, b.thresholdWarning, b.thresholdCritical)
            : "normal";
        return { binding: b, pos, offset, value: v ?? null, state };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [bindings, positions, values]);

  if (placed.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none">
      {showLeaderLines && (
        <svg
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="none"
        >
          {placed.map(({ binding, pos, offset, state }) => {
            const colors = SCHEMATIC_THEME.threshold[state];
            const toX = pos.x + offset.dx;
            const toY = pos.y + offset.dy;
            const baseOpacity =
              state === "normal"
                ? SCHEMATIC_THEME.connector.opacity
                : Math.min(1, SCHEMATIC_THEME.connector.opacity + 0.45);
            return (
              <g key={binding.id}>
                <line
                  x1={pos.x}
                  y1={pos.y}
                  x2={toX}
                  y2={toY}
                  stroke={colors.stroke}
                  strokeWidth={SCHEMATIC_THEME.connector.width}
                  opacity={baseOpacity}
                  strokeLinecap="round"
                />
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={SCHEMATIC_THEME.cap.radius}
                  fill={colors.cap}
                />
                {state !== "normal" && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={
                      SCHEMATIC_THEME.cap.radius +
                      SCHEMATIC_THEME.cap.outlineWidth +
                      0.5
                    }
                    fill="none"
                    stroke={colors.stroke}
                    strokeWidth={SCHEMATIC_THEME.cap.outlineWidth}
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {placed.map(({ binding, pos, offset, value, state }) => (
        <div
          key={binding.id}
          className="absolute"
          style={{
            left: pos.x + offset.dx,
            top: pos.y + offset.dy,
            transform: "translate(-50%, -50%)",
            animation:
              state === "critical"
                ? `pulse ${SCHEMATIC_THEME.motion.pulseMs}ms ease-in-out infinite`
                : undefined,
          }}
        >
          <Callout
            binding={binding}
            value={value}
            defaultUnit={units?.[binding.metric]}
            extras={extras?.[binding.metric]}
            compact
          />
        </div>
      ))}
    </div>
  );
}
