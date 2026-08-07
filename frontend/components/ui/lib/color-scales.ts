/**
 * Color Scale Utilities
 *
 * Shared color mapping functions for data visualization components.
 * These scales map normalized values (0-1) to colors, providing consistent
 * color schemes across different chart types.
 *
 * @module color-scales
 */

/**
 * Color stop for gradient-based scales
 */
export interface ColorStop {
  /** Position in the gradient (0-1) */
  position: number;
  /** RGB color values [r, g, b] where each value is 0-255 */
  color: [number, number, number];
}

/**
 * Interpolates between two colors
 */
function interpolateColor(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(c1[0] + t * (c2[0] - c1[0])),
    Math.round(c1[1] + t * (c2[1] - c1[1])),
    Math.round(c1[2] + t * (c2[2] - c1[2])),
  ];
}

/**
 * Creates a color scale function from an array of color stops
 *
 * @param stops Array of color stops defining the gradient
 * @returns Function that maps values (0-1) to RGB color strings
 *
 * @example
 * ```ts
 * const scale = createColorScale([
 *   { position: 0, color: [0, 0, 255] },   // Blue at 0
 *   { position: 0.5, color: [0, 255, 0] }, // Green at 0.5
 *   { position: 1, color: [255, 0, 0] }    // Red at 1
 * ]);
 *
 * scale(0)    // "rgb(0, 0, 255)"
 * scale(0.25) // "rgb(0, 127, 127)"
 * scale(0.5)  // "rgb(0, 255, 0)"
 * scale(1)    // "rgb(255, 0, 0)"
 * ```
 */
export function createColorScale(
  stops: ColorStop[]
): (value: number) => string {
  if (stops.length === 0) {
    throw new Error("Color scale must have at least one stop");
  }

  if (stops.length === 1) {
    const [r, g, b] = stops[0].color;
    return () => `rgb(${r}, ${g}, ${b})`;
  }

  // Sort stops by position
  const sortedStops = [...stops].sort((a, b) => a.position - b.position);

  return (value: number) => {
    const clamped = Math.max(0, Math.min(1, value));

    // Find the two stops to interpolate between
    for (let i = 0; i < sortedStops.length - 1; i++) {
      const stop1 = sortedStops[i];
      const stop2 = sortedStops[i + 1];

      if (clamped <= stop2.position) {
        // Interpolate between stop1 and stop2
        const t =
          (clamped - stop1.position) / (stop2.position - stop1.position);
        const [r, g, b] = interpolateColor(stop1.color, stop2.color, t);
        return `rgb(${r}, ${g}, ${b})`;
      }
    }

    // If we get here, return the last color
    const [r, g, b] = sortedStops[sortedStops.length - 1].color;
    return `rgb(${r}, ${g}, ${b})`;
  };
}

/**
 * Creates a sequential color scale from an array of colors
 * Colors are evenly distributed across the 0-1 range
 *
 * @param colors Array of RGB colors
 * @returns Function that maps values (0-1) to RGB color strings
 *
 * @example
 * ```ts
 * const scale = createSequentialScale([
 *   [68, 1, 84],     // Purple
 *   [59, 82, 139],   // Blue
 *   [33, 145, 140],  // Cyan
 *   [94, 201, 98],   // Green
 *   [253, 231, 37]   // Yellow
 * ]);
 * ```
 */
export function createSequentialScale(
  colors: Array<[number, number, number]>
): (value: number) => string {
  if (colors.length === 0) {
    throw new Error("Sequential scale must have at least one color");
  }

  if (colors.length === 1) {
    const [r, g, b] = colors[0];
    return () => `rgb(${r}, ${g}, ${b})`;
  }

  const stops: ColorStop[] = colors.map((color, i) => ({
    position: i / (colors.length - 1),
    color,
  }));

  return createColorScale(stops);
}

// ============================================================================
// Predefined Color Scales
// ============================================================================

/**
 * Viridis color scale (perceptually uniform, colorblind-friendly)
 * Maps from purple → blue → cyan → green → yellow
 *
 * Excellent for:
 * - Scientific visualization
 * - Heatmaps
 * - Any data where perceptual uniformity matters
 *
 * @example
 * ```tsx
 * <HeatmapChart data={data} colorScale={viridis} />
 * ```
 */
export const viridis = createSequentialScale([
  [68, 1, 84], // Purple
  [59, 82, 139], // Blue
  [33, 145, 140], // Cyan
  [94, 201, 98], // Green
  [253, 231, 37], // Yellow
]);

/**
 * Plasma color scale (perceptually uniform)
 * Maps from purple → pink → orange → yellow
 *
 * Excellent for:
 * - Thermal data
 * - Intensity maps
 * - Eye-catching visualizations
 *
 * @example
 * ```tsx
 * <HeatmapChart data={data} colorScale={plasma} />
 * ```
 */
export const plasma = createSequentialScale([
  [13, 8, 135], // Deep purple
  [126, 3, 167], // Purple
  [204, 71, 120], // Pink
  [248, 149, 64], // Orange
  [240, 249, 33], // Yellow
]);

/**
 * Inferno color scale (perceptually uniform, high contrast)
 * Maps from black → purple → red → orange → yellow
 *
 * Excellent for:
 * - Heat visualization
 * - Fire/energy data
 * - High-contrast needs
 *
 * @example
 * ```tsx
 * <HeatmapChart data={data} colorScale={inferno} />
 * ```
 */
export const inferno = createSequentialScale([
  [0, 0, 4], // Black
  [87, 16, 110], // Purple
  [188, 55, 84], // Red
  [249, 142, 9], // Orange
  [252, 255, 164], // Pale yellow
]);

/**
 * Cool color scale
 * Maps from cyan → blue → purple
 *
 * Excellent for:
 * - Water/ocean data
 * - Low-temperature visualization
 * - Calming aesthetics
 *
 * @example
 * ```tsx
 * <HeatmapChart data={data} colorScale={cool} />
 * ```
 */
export const cool = createSequentialScale([
  [0, 255, 255], // Cyan
  [0, 128, 255], // Light blue
  [0, 0, 255], // Blue
  [128, 0, 255], // Purple
]);

/**
 * Warm color scale
 * Maps from yellow → orange → red
 *
 * Excellent for:
 * - Temperature data
 * - Energy visualization
 * - Alert levels
 *
 * @example
 * ```tsx
 * <HeatmapChart data={data} colorScale={warm} />
 * ```
 */
export const warm = createSequentialScale([
  [255, 255, 0], // Yellow
  [255, 192, 0], // Orange-yellow
  [255, 128, 0], // Orange
  [255, 64, 0], // Red-orange
  [255, 0, 0], // Red
]);

/**
 * Diverging color scale (blue → white → red)
 *
 * Excellent for:
 * - Data with a meaningful center point (e.g., 0)
 * - Showing deviation from a baseline
 * - Comparing above/below average
 *
 * @example
 * ```tsx
 * // For data centered around 0
 * const scale = (value: number) => diverging((value + 1) / 2);
 * <HeatmapChart data={data} colorScale={scale} />
 * ```
 */
export const diverging = createColorScale([
  { position: 0, color: [0, 0, 255] }, // Blue
  { position: 0.5, color: [255, 255, 255] }, // White
  { position: 1, color: [255, 0, 0] }, // Red
]);

/**
 * Grayscale color scale
 * Maps from black → white
 *
 * Excellent for:
 * - Printing
 * - Intensity/density data
 * - Minimalist aesthetics
 * - Accessibility (when color isn't needed)
 *
 * @example
 * ```tsx
 * <HeatmapChart data={data} colorScale={grayscale} />
 * ```
 */
export const grayscale = createSequentialScale([
  [0, 0, 0], // Black
  [64, 64, 64], // Dark gray
  [128, 128, 128], // Medium gray
  [192, 192, 192], // Light gray
  [255, 255, 255], // White
]);

/**
 * Turbo color scale (rainbow-like but more perceptually uniform than traditional rainbow)
 * Maps across the full visible spectrum with better luminance distribution
 *
 * Excellent for:
 * - Eye-catching visualizations
 * - Wide data ranges
 * - When you need maximum visual distinction
 *
 * Note: Use with caution - rainbow scales can be misleading and
 * are not colorblind-friendly. Prefer viridis/plasma when possible.
 *
 * @example
 * ```tsx
 * <HeatmapChart data={data} colorScale={turbo} />
 * ```
 */
export const turbo = createSequentialScale([
  [48, 18, 59], // Deep purple
  [66, 64, 134], // Purple
  [53, 183, 121], // Green
  [199, 216, 64], // Yellow-green
  [253, 231, 37], // Yellow
  [234, 51, 35], // Red
]);

/**
 * Default color scale (alias for viridis)
 * This is used as the default in components when no scale is specified
 */
export const defaultColorScale = viridis;

/**
 * All available color scales as a named map
 * Useful for dynamic scale selection in UI controls
 *
 * @example
 * ```tsx
 * const [scaleName, setScaleName] = useState<keyof typeof colorScales>('viridis');
 *
 * <select onChange={(e) => setScaleName(e.target.value)}>
 *   {Object.keys(colorScales).map(name => (
 *     <option key={name} value={name}>{name}</option>
 *   ))}
 * </select>
 *
 * <HeatmapChart data={data} colorScale={colorScales[scaleName]} />
 * ```
 */
export const colorScales = {
  viridis,
  plasma,
  inferno,
  cool,
  warm,
  diverging,
  grayscale,
  turbo,
} as const;

export type ColorScaleName = keyof typeof colorScales;
