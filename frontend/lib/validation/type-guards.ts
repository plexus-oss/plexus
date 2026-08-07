/**
 * Type guards and coercion utilities for chart data validation
 */

import type { FlexValue } from "@/lib/types/dashboard";

/**
 * Check if a value is a finite number
 */
export function isNumericValue(value: FlexValue): value is number {
  return typeof value === "number" && isFinite(value);
}

/**
 * Coerce a value to a number, returning null if not possible
 */
export function coerceToNumber(value: FlexValue): number | null {
  if (isNumericValue(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = parseFloat(trimmed);
    return isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

/**
 * Check if a string is a valid ISO timestamp
 */
export function isValidTimestamp(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}
