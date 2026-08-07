/**
 * Walk a live SVG DOM and extract every <text> node as a labeled point.
 *
 * Used by the auto-detect-pins flow: every text label becomes a candidate
 * for fuzzy matching against the device's metric schema.
 *
 * Position is computed in root-viewBox coords via getCTM so accumulated
 * group transforms resolve correctly.
 */

import { svgElementCenter } from "./anchor-resolver";

export interface ExtractedLabel {
  /** Trimmed textContent (concatenates <tspan> children automatically). */
  text: string;
  /** Center of the text element's bounding box in viewBox space. */
  x: number;
  y: number;
  /** The element's own id (if any) — preferred anchor target when binding. */
  id?: string;
  /** Nearest ancestor with an id — fallback anchor target. */
  ancestorId?: string;
}

/**
 * Heuristics for filtering noise: text in elements whose id/class contains
 * any of these tokens is skipped (legends, titles, frame borders, notes).
 */
const NOISE_PATTERN = /\b(legend|title|border|notes?|footer|header|key)\b/i;

/** Drop labels longer than this (probably a paragraph, not a probe label). */
const MAX_LABEL_LENGTH = 32;

export function extractLabels(svg: SVGSVGElement): ExtractedLabel[] {
  const out: ExtractedLabel[] = [];
  const texts = svg.querySelectorAll("text");
  for (const text of Array.from(texts)) {
    const raw = (text.textContent ?? "").trim();
    if (!raw || raw.length > MAX_LABEL_LENGTH) continue;
    if (isNoise(text)) continue;

    const center = svgElementCenter(svg, text as SVGGraphicsElement);
    if (!center) continue;

    out.push({
      text: raw,
      x: center.x,
      y: center.y,
      id: text.id || undefined,
      ancestorId: nearestIdAncestor(text, svg),
    });
  }
  return out;
}

function isNoise(el: Element): boolean {
  let cursor: Element | null = el;
  while (cursor) {
    const id = cursor.getAttribute("id") || "";
    const cls = cursor.getAttribute("class") || "";
    if (NOISE_PATTERN.test(id) || NOISE_PATTERN.test(cls)) return true;
    cursor = cursor.parentElement;
  }
  return false;
}

function nearestIdAncestor(el: Element, root: Element): string | undefined {
  let cursor: Element | null = el.parentElement;
  while (cursor && cursor !== root) {
    if (cursor.id && cursor.id.trim().length > 0) return cursor.id;
    cursor = cursor.parentElement;
  }
  return undefined;
}
