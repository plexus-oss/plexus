/**
 * Earth Constants - Astronomically Accurate Values
 *
 * Extracted from components/earth.tsx so that non-3D modules
 * (e.g. lib/orbital/propagation.ts) can import these without
 * pulling Three.js into the bundle.
 */

export const EARTH_RADIUS_KM = 6371.0;
export const SCENE_SCALE = 0.001;
export const EARTH_RADIUS = EARTH_RADIUS_KM * SCENE_SCALE;
export const EARTH_ROTATION_PERIOD_SECONDS = 86164.0905; // Sidereal day
export const EARTH_ORBITAL_PERIOD_DAYS = 365.256363004; // Sidereal year
export const EARTH_AXIAL_TILT_DEG = 23.4392811;
