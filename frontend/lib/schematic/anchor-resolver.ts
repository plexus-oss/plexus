/**
 * Resolve an AnchorRef to a viewBox-space {x, y} point on a live SVG DOM.
 *
 * `svg-id` anchors look up the element by id and return its bbox center,
 * walking the parent CTM chain so grouped/transformed elements resolve to
 * the correct root-viewBox coordinates (the single most common bug when
 * doing this without getCTM math).
 *
 * `svg-point` anchors return the raw stored coords.
 */

import type { AnchorRef } from "@/lib/types/dashboard";

export interface ResolvedPoint {
  x: number;
  y: number;
}

/**
 * Resolve an anchor against a root SVG element. Returns null when the
 * referenced id can't be found (SVG was swapped out, id was renamed).
 */
export function resolveAnchor(
  svg: SVGSVGElement | null,
  anchor: AnchorRef,
): ResolvedPoint | null {
  if (anchor.kind === "svg-point") {
    return { x: anchor.x, y: anchor.y };
  }
  if (anchor.kind === "mesh-name") {
    // 3D anchors aren't resolved here — the Model3D panel projects
    // mesh world position to screen separately.
    return null;
  }
  if (!svg) return null;

  // svg-id path
  const el = svg.querySelector(`[id="${cssEscape(anchor.id)}"]`);
  if (!el || !(el instanceof SVGGraphicsElement)) return null;

  return svgElementCenter(svg, el);
}

/**
 * Compute the center of an SVG element in the root SVG's viewBox
 * coordinate space, accounting for accumulated parent transforms.
 *
 * Approach: use getCTM to get element → screen-CTM, invert the root
 * SVG's screen-CTM to get screen → root-viewBox, and compose.
 *
 * Falls back to the raw bbox center if CTM math is unavailable.
 */
export function svgElementCenter(
  svg: SVGSVGElement,
  el: SVGGraphicsElement,
): ResolvedPoint | null {
  try {
    const bbox = el.getBBox();
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    const elCtm = el.getCTM();
    const svgCtm = svg.getCTM();
    if (!elCtm || !svgCtm) return { x: cx, y: cy };

    // Map (cx, cy) from element-local space to screen, then screen → root viewBox.
    const point = svg.createSVGPoint();
    point.x = cx;
    point.y = cy;
    const screenPoint = point.matrixTransform(elCtm);
    const rootPoint = screenPoint.matrixTransform(svgCtm.inverse());
    return { x: rootPoint.x, y: rootPoint.y };
  } catch {
    return null;
  }
}

/** CSS.escape polyfill — older browsers and JSDOM don't have it. */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/(["\\#.:>+~*\[\]()'])/g, "\\$1");
}

/**
 * Convert a client-space {x, y} (mouse event coords) to root SVG
 * viewBox-space coords, accounting for any active CSS transform on the
 * SVG's parent (zoom/pan wrappers).
 */
export function clientToViewBox(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): ResolvedPoint | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const transformed = point.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}

/**
 * Walk up from a hit element through its parents, returning the
 * nearest ancestor with a non-empty id (excluding the root <svg>).
 * Used so click-to-bind snaps to the most specific labeled group.
 */
export function findNearestIdAncestor(
  svg: SVGSVGElement,
  el: Element | null,
): SVGGraphicsElement | null {
  let cursor: Element | null = el;
  while (cursor && cursor !== svg) {
    if (
      cursor instanceof SVGGraphicsElement &&
      cursor.id &&
      cursor.id.trim().length > 0
    ) {
      return cursor;
    }
    cursor = cursor.parentElement;
  }
  return null;
}
