/**
 * User Settings - Types & Local Storage
 *
 * Manages user preferences stored in localStorage.
 */

import { getBrowserTimezone } from "@/lib/timezone";

// =============================================================================
// TYPES
// =============================================================================

export interface UserSettings {
  /** IANA timezone identifier (e.g., "America/New_York", "UTC") */
  timezone: string;
  /** Use 12-hour time format (true) or 24-hour format (false) */
  use12HourFormat: boolean;
  /** Last updated timestamp (ISO string) */
  updatedAt: string;
}

export type UserSettingsUpdate = Partial<Omit<UserSettings, "updatedAt">>;

// =============================================================================
// CONSTANTS
// =============================================================================

const STORAGE_KEY = "plexus-user-settings";

export const DEFAULT_USER_SETTINGS: UserSettings = {
  timezone: "UTC",
  use12HourFormat: false,
  updatedAt: new Date().toISOString(),
};

// =============================================================================
// STORAGE FUNCTIONS
// =============================================================================

/**
 * Get user settings from localStorage
 * Returns defaults if not found or on server-side
 */
export function getUserSettings(): UserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_USER_SETTINGS;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const browserTz = getBrowserTimezone();
      return {
        ...DEFAULT_USER_SETTINGS,
        timezone: browserTz,
      };
    }
    return { ...DEFAULT_USER_SETTINGS, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

/**
 * Save user settings to localStorage
 */
export function setUserSettings(updates: UserSettingsUpdate): UserSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_USER_SETTINGS, ...updates };
  }

  const current = getUserSettings();
  const updated: UserSettings = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to save user settings:", error);
  }

  return updated;
}

/**
 * Clear all user settings (reset to defaults)
 */
export function clearUserSettings(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
