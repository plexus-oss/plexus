/**
 * The canonical dashboard series palette — the exact swatches the panel color
 * picker offers (the "config" colors a user picks by hand). Auto-built
 * dashboards (the quick-start layout) assign series colors from THIS list so
 * their charts match what a hand-configured panel would look like, instead of
 * a separate hand-rolled palette.
 *
 * Single source of truth: the color picker (config-sections/shared-config.tsx)
 * and the quick-start builder both import this. Don't fork another palette.
 */
export const DASHBOARD_COLORS = [
  "#3700FF", // blue
  "#BF00FF", // purple
  "#FB13F3", // violet
  "#00D4FF", // cyan
  "#FF6B35", // orange
  "#bdf92e", // yellow
];
