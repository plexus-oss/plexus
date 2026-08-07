/**
 * Design tokens for the Schematic and 3D Model panels.
 *
 * Anything visual that both panels share lives here so they stay in lockstep:
 * pin dot sizes, callout chrome, threshold semantics, animation timings.
 */

/**
 * Theme tokens for the Schematic and 3D Model panel "Revel-style" overlays.
 *
 * Two pieces of chrome we render at every pin:
 *   - a *cap* — a small filled circle at the connector's anchor end
 *   - a *chip* — the value/label/unit callout, positioned at offset
 *
 * The dot (a separate stand-alone marker) was redundant against the cap
 * and got dropped. Click target is the chip itself.
 */
/**
 * Tuned to match the Revel reference: near-monochrome leaders and chips
 * on near-black, with color used only for state (warn/critical).
 */
export const SCHEMATIC_THEME = {
  cap: {
    /** Radius of the small terminus at the connector's anchor end (CSS px). */
    radius: 2,
    /** Outline color (rendered only when state != "normal"). */
    outline: "rgba(255, 255, 255, 0.55)",
    outlineWidth: 0.5,
  },
  callout: {
    /** Connector switches to dashed past this many px. */
    connectorSolidMax: 200,
    /** Default offset of a freshly-placed callout from its anchor (CSS px at base render). */
    defaultOffset: { dx: 84, dy: -42 } as const,
    /** Chrome corner radius. */
    radius: 2,
  },
  connector: {
    /** Hairline. */
    width: 0.75,
    dashArray: "4 3",
    /** Base opacity 0..1 of the connector in the normal state. */
    opacity: 0.32,
    /** Multiplier added on hover. */
    hoverBoost: 0.35,
  },
  /**
   * Threshold-driven colors. Normal state is intentionally monochrome —
   * matches the Revel reference where the leader and chip border are
   * almost invisible until something goes amber/red.
   */
  threshold: {
    normal: {
      fg: "rgb(245, 245, 247)", // near-white text
      border: "rgba(255, 255, 255, 0.10)",
      stroke: "rgba(255, 255, 255, 0.42)",
      cap: "rgba(255, 255, 255, 0.65)",
      bg: "rgba(8, 10, 14, 0.78)",
    },
    warn: {
      fg: "rgb(251, 191, 36)", // amber-400
      border: "rgba(251, 191, 36, 0.45)",
      stroke: "rgba(251, 191, 36, 0.75)",
      cap: "rgb(251, 191, 36)",
      bg: "rgba(16, 12, 4, 0.82)",
    },
    critical: {
      fg: "rgb(248, 113, 113)", // red-400
      border: "rgba(248, 113, 113, 0.65)",
      stroke: "rgba(248, 113, 113, 0.9)",
      cap: "rgb(248, 113, 113)",
      bg: "rgba(20, 8, 8, 0.85)",
    },
  },
  motion: {
    pulseMs: 1400,
    transitionMs: 150,
  },
  edit: {
    ringColor: "rgb(34, 211, 238)", // cyan-400
    ringWidth: 1.25,
  },
} as const;

export type ThresholdState = "normal" | "warn" | "critical";

/**
 * Classify a value against optional thresholds. Both thresholds are
 * "greater-or-equal" — same semantics as Model3DPartBinding.
 */
export function thresholdFor(
  value: number | null | undefined,
  warn?: number,
  critical?: number,
): ThresholdState {
  if (value === null || value === undefined || Number.isNaN(value))
    return "normal";
  if (critical !== undefined && value >= critical) return "critical";
  if (warn !== undefined && value >= warn) return "warn";
  return "normal";
}
