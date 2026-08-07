/**
 * Single source of truth for annotation colors.
 * `dot` (Tailwind class) serves swatches, panel dots, and band fills;
 * `rgb` serves inline styles (guide lines, edges, tooltip dots).
 */
export const ANNOTATION_COLORS = [
  { id: "amber", dot: "bg-amber-500", rgb: "245,158,11" },
  { id: "blue", dot: "bg-blue-500", rgb: "59,130,246" },
  { id: "green", dot: "bg-green-500", rgb: "34,197,94" },
  { id: "red", dot: "bg-red-500", rgb: "239,68,68" },
  { id: "purple", dot: "bg-purple-500", rgb: "168,85,247" },
  { id: "gray", dot: "bg-gray-400", rgb: "156,163,175" },
] as const;

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]["id"];

type AnnotationColorEntry = (typeof ANNOTATION_COLORS)[number];

export function getAnnotationColor(
  color: string | null | undefined,
): AnnotationColorEntry {
  return (
    ANNOTATION_COLORS.find((c) => c.id === color) ?? ANNOTATION_COLORS[0]
  );
}

export const annotationRgb = (color: string | null | undefined): string =>
  `rgb(${getAnnotationColor(color).rgb})`;

export const annotationRgba = (
  color: string | null | undefined,
  alpha: number,
): string => `rgba(${getAnnotationColor(color).rgb},${alpha})`;
