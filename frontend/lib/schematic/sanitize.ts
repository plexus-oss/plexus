/**
 * Safely inline a user-uploaded SVG into our DOM.
 *
 * User-uploaded SVG can contain <script>, event handlers, embedded
 * <foreignObject> with arbitrary HTML, and javascript: URIs. We sanitize
 * with the SVG profile and explicitly forbid foreignObject (the main XSS
 * vector through DOMPurify's default SVG allow-list).
 */

import DOMPurify, { type Config } from "dompurify";

const PURIFY_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["foreignObject", "script"],
  FORBID_ATTR: ["onload", "onclick", "onerror", "onmouseover"],
};

/**
 * Sanitize raw SVG markup. Returns an SVG string suitable for
 * inline injection via dangerouslySetInnerHTML.
 */
export function sanitizeSvg(rawSvg: string): string {
  if (typeof window === "undefined") {
    // We only sanitize client-side; DOMPurify needs window. Server-side
    // callers should treat the source as untrusted and not render it.
    return "";
  }
  return DOMPurify.sanitize(rawSvg, PURIFY_CONFIG);
}

/**
 * Extract the viewBox from an SVG string. If absent, attempt to read
 * width/height and synthesize a viewBox from them. Returns null when no
 * dimensions are recoverable.
 */
export function extractViewBox(svgText: string): string | null {
  const viewBoxMatch = svgText.match(/viewBox\s*=\s*"([^"]+)"/);
  if (viewBoxMatch) return viewBoxMatch[1].trim();

  const widthMatch = svgText.match(/\swidth\s*=\s*"([^"]+)"/);
  const heightMatch = svgText.match(/\sheight\s*=\s*"([^"]+)"/);
  if (widthMatch && heightMatch) {
    const w = parseFloat(widthMatch[1]);
    const h = parseFloat(heightMatch[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return `0 0 ${w} ${h}`;
    }
  }
  return null;
}
