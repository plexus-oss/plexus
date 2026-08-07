/**
 * Centralized keyboard shortcut constants.
 *
 * Taken keys (do not reuse without removing the old binding):
 *
 *   Page actions (context-dependent single keys)
 *     N    New dashboard           A    Add device / Add panel
 *     P    Pair source             C    Add connection
 *     R    New run                 M    New monitor
 *
 *   List navigation
 *     J    Next item               K    Previous item
 *     Enter Open item              E    Edit item
 *     D    Delete item
 *
 *   Global
 *     ?    Show shortcuts
 */

// ---------------------------------------------------------------------------
// Page actions
// ---------------------------------------------------------------------------
export const ACTION_NEW_DASHBOARD = "N";
export const ACTION_ADD_DEVICE = "A";
export const ACTION_PAIR_SOURCE = "P";
export const ACTION_ADD_CONNECTION = "C";
export const ACTION_ADD_PANEL = "A";
export const ACTION_NEW_RUN = "R";
export const ACTION_NEW_MONITOR = "M";
export const ACTION_EDIT = "e";
export const ACTION_DELETE = "d";

// ---------------------------------------------------------------------------
// List navigation
// ---------------------------------------------------------------------------
export const LIST_NEXT = "j";
export const LIST_PREV = "k";
export const LIST_OPEN = "enter";

// ---------------------------------------------------------------------------
// Global
// ---------------------------------------------------------------------------
export const SHOW_SHORTCUTS = "?";
