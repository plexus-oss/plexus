"use client";

/**
 * SchematicCanvas — the pan/zoom-enabled inlined SVG container.
 *
 * Responsibilities:
 *   1. Fetch the user-uploaded SVG from `svgUrl`.
 *   2. Sanitize it (DOMPurify, SVG profile, no foreignObject).
 *   3. Inline the markup into a wrapper so we can DOM-query its <text>
 *      nodes for auto-mapping and resolve svg-id anchors at render time.
 *   4. Mount a react-zoom-pan-pinch transform around the inlined SVG +
 *      an overlay layer that holds the pins. Both transform together.
 *   5. Publish the current transform (scale, x, y) and the live svg ref
 *      to children via a context, so PinOverlay can counter-scale and
 *      resolve anchors.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import { sanitizeSvg, extractViewBox } from "@/lib/schematic/sanitize";
import {
  clientToViewBox,
  findNearestIdAncestor,
} from "@/lib/schematic/anchor-resolver";
import type { AnchorRef } from "@/lib/types/dashboard";

interface SchematicContextValue {
  /** Ref to the inlined root <svg> element. */
  svgRef: SVGSVGElement | null;
  /** Current zoom scale; pins divide chrome size by this to stay legible. */
  scale: number;
  /** The viewBox we resolved for the inlined SVG. */
  viewBox: { x: number; y: number; width: number; height: number } | null;
  /** Imperative pan/zoom controls (resetTransform, zoomIn, zoomOut, …). */
  controls: ReactZoomPanPinchRef | null;
  /** Width of the outer (un-transformed) container in CSS px — used by
   * the pin overlay to compute a zoom-stable viewBox-per-pixel ratio. */
  basePanelWidth: number;
}

const SchematicContext = createContext<SchematicContextValue>({
  svgRef: null,
  scale: 1,
  viewBox: null,
  controls: null,
  basePanelWidth: 0,
});

export function useSchematicContext() {
  return useContext(SchematicContext);
}

interface SchematicCanvasProps {
  svgUrl: string | undefined;
  /** Background opacity 0..1 for the underlying SVG. */
  backgroundOpacity?: number;
  /** Children render inside the transform — pins, edit overlay. */
  children?: ReactNode;
  /** Empty-state element when no SVG is configured. */
  emptyState?: ReactNode;
  /** When true, enable click-to-add-pin interactions. */
  editing?: boolean;
  /**
   * Fired in edit mode when the user clicks the schematic.
   * Resolves the click to the most specific anchor available:
   *   1. Nearest SVG ancestor with an id → `svg-id`
   *   2. Otherwise → `svg-point` at the clicked viewBox coord
   */
  onAnchorClick?: (anchor: AnchorRef) => void;
}

export function SchematicCanvas({
  svgUrl,
  backgroundOpacity = 1,
  children,
  emptyState,
  editing = false,
  onAnchorClick,
}: SchematicCanvasProps) {
  const [svgText, setSvgText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const [basePanelWidth, setBasePanelWidth] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  // Imperative pan/zoom controls, held in state (not a ref) so the context
  // value updates once the TransformWrapper mounts and so we never read a ref
  // during render. The useState setter is stable, so it's a safe callback ref.
  const [controls, setControls] = useState<ReactZoomPanPinchRef | null>(null);

  // Track the un-transformed panel width so the overlay can pick a
  // zoom-stable px → viewBox ratio. ResizeObserver fires on actual size
  // changes (panel resize, layout reflow) but NOT when the inner
  // TransformComponent zooms — exactly what we want.
  useEffect(() => {
    if (!outerRef.current) return;
    const el = outerRef.current;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setBasePanelWidth(rect.width);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clear the inlined SVG when the URL is removed (deferred so it isn't a
  // synchronous setState in the effect body). Only fires on URL removal, so a
  // direct A -> B URL switch keeps the old schematic visible until B loads.
  useEffect(() => {
    if (svgUrl) return;
    const id = setTimeout(() => setSvgText(null), 0);
    return () => clearTimeout(id);
  }, [svgUrl]);

  // Fetch + sanitize on URL change.
  useEffect(() => {
    if (!svgUrl) return;
    let cancelled = false;
    // Deferred so it isn't a synchronous setState in the effect body; clears
    // any prior error as soon as a new fetch starts.
    const clearErr = setTimeout(() => setError(null), 0);
    fetch(svgUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load SVG (${r.status})`);
        return r.text();
      })
      .then((raw) => {
        if (cancelled) return;
        const cleaned = sanitizeSvg(raw);
        if (!cleaned) {
          setError("Could not sanitize uploaded SVG.");
          return;
        }
        setSvgText(cleaned);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load schematic");
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(clearErr);
    };
  }, [svgUrl]);

  // Attach to the inlined <svg>: ensure it fills the container and capture
  // a ref for anchor resolution + DOM queries.
  useEffect(() => {
    if (!wrapperRef.current || !svgText) {
      setSvgEl(null);
      return;
    }
    const svg = wrapperRef.current.querySelector("svg");
    if (!(svg instanceof SVGSVGElement)) {
      setSvgEl(null);
      return;
    }
    // Strip any width/height that would otherwise constrain us — we want
    // the SVG to fill its container while preserving aspect ratio.
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.display = "block";
    svg.style.opacity = String(backgroundOpacity);
    // In edit mode we WANT the SVG to receive pointer events so the click
    // handler can identify what was clicked. In view mode we suppress them
    // so pins underneath can be hovered through to the schematic.
    svg.style.pointerEvents = editing ? "auto" : "none";
    setSvgEl(svg);
  }, [svgText, backgroundOpacity, editing]);

  const handleContentClick = useMemo(() => {
    if (!editing || !onAnchorClick) return undefined;
    return (e: React.MouseEvent<HTMLDivElement>) => {
      if (!svgEl) return;
      // Find the deepest SVG element under the pointer. We use
      // elementFromPoint rather than e.target because the user may have
      // clicked through a nested decorative element we want to ignore.
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (!hit) return;
      // Walk up to find an SVGGraphicsElement with an id.
      const idAncestor = findNearestIdAncestor(svgEl, hit);
      if (idAncestor) {
        onAnchorClick({ kind: "svg-id", id: idAncestor.id });
        return;
      }
      // Fallback: snap to the raw click point in viewBox coords.
      const point = clientToViewBox(svgEl, e.clientX, e.clientY);
      if (!point) return;
      onAnchorClick({ kind: "svg-point", x: point.x, y: point.y });
    };
  }, [editing, onAnchorClick, svgEl]);

  const viewBox = useMemo(() => {
    if (!svgText) return null;
    const raw = extractViewBox(svgText);
    if (!raw) return null;
    const [x, y, w, h] = raw.split(/\s+/).map(parseFloat);
    if (
      ![x, y, w, h].every(Number.isFinite) ||
      !Number.isFinite(w) ||
      !Number.isFinite(h)
    )
      return null;
    return { x, y, width: w, height: h };
  }, [svgText]);

  const ctxValue: SchematicContextValue = useMemo(
    () => ({
      svgRef: svgEl,
      scale,
      viewBox,
      controls,
      basePanelWidth,
    }),
    [svgEl, scale, viewBox, controls, basePanelWidth],
  );

  // ── Empty / error states ───────────────────────────────────────────
  if (!svgUrl) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background/40">
        {emptyState}
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-destructive">
        {error}
      </div>
    );
  }
  if (!svgText) {
    return (
      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">
        Loading schematic…
      </div>
    );
  }

  return (
    <SchematicContext.Provider value={ctxValue}>
      <div ref={outerRef} className="relative h-full w-full overflow-hidden">
        <TransformWrapper
          ref={setControls}
          initialScale={1}
          minScale={0.2}
          maxScale={8}
          limitToBounds={false}
          wheel={{ step: 0.15 }}
          doubleClick={{ disabled: false, mode: "reset" }}
          onTransform={(ref) => {
            setScale(ref.state.scale);
          }}
        >
          <TransformComponent
            wrapperClass="!w-full !h-full"
            contentClass="!w-full !h-full"
          >
            <div
              ref={wrapperRef}
              className={
                "relative w-full h-full " +
                (editing ? "cursor-crosshair" : "")
              }
              onClick={handleContentClick}
              dangerouslySetInnerHTML={{ __html: svgText }}
            />
            {children}
          </TransformComponent>
        </TransformWrapper>
      </div>
    </SchematicContext.Provider>
  );
}
