"use client";

import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
  ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  UserSettings,
  UserSettingsUpdate,
  getUserSettings,
  setUserSettings as saveUserSettings,
  DEFAULT_USER_SETTINGS,
} from "@/lib/user-settings";

// Routes that should skip API calls (no auth available)
const PUBLIC_ROUTES = ["/shared", "/sign-in", "/sign-up"];

interface UserSettingsContextValue {
  settings: UserSettings;
  updateSettings: (updates: UserSettingsUpdate) => void;
  isLoaded: boolean;
}

const UserSettingsContext = createContext<UserSettingsContextValue | null>(
  null,
);

async function fetchSettingsFromAPI(): Promise<Partial<UserSettings> | null> {
  try {
    const response = await fetch("/api/user-settings");
    if (!response.ok) return null;
    const data = await response.json();
    return data.settings;
  } catch {
    return null;
  }
}

async function saveSettingsToAPI(updates: UserSettingsUpdate): Promise<void> {
  try {
    await fetch("/api/user-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  } catch {
    // Silently fail - localStorage is the fallback
  }
}

// ---------------------------------------------------------------------------
// localStorage-backed external store
//
// Settings live in localStorage (a system outside React). We read them through
// useSyncExternalStore, which is the React-idiomatic, hydration-safe way to
// subscribe to an external store: it renders the server snapshot (defaults) on
// the server and during the first client render, then switches to the live
// localStorage value — without a synchronous setState inside an effect.
// ---------------------------------------------------------------------------

const settingsListeners = new Set<() => void>();
let settingsCache: UserSettings | null = null;

/** Invalidate the cached snapshot and notify subscribers of a settings change. */
function emitSettingsChange() {
  settingsCache = null;
  for (const listener of settingsListeners) listener();
}

function subscribeSettings(listener: () => void): () => void {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

/** Cached so successive calls return a stable reference (required by the hook). */
function getSettingsSnapshot(): UserSettings {
  if (settingsCache === null) {
    settingsCache = getUserSettings();
  }
  return settingsCache;
}

function getSettingsServerSnapshot(): UserSettings {
  return DEFAULT_USER_SETTINGS;
}

// "Has hydrated" store: false on the server and the first client render, true
// afterward — mirrors the original `isLoaded` flag without a setState-in-effect.
const noopSubscribe = (): (() => void) => () => {};
const getHydratedSnapshot = () => true;
const getHydratedServerSnapshot = () => false;

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  // Read settings from the localStorage-backed external store. Server/first
  // render get DEFAULT_USER_SETTINGS; the live value applies after hydration.
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsServerSnapshot,
  );
  const isLoaded = useSyncExternalStore(
    noopSubscribe,
    getHydratedSnapshot,
    getHydratedServerSnapshot,
  );
  const hasSyncedRef = useRef(false);
  const pathname = usePathname();

  // Check if we're on a public route (no auth available)
  const isPublicRoute = PUBLIC_ROUTES.some((route) =>
    pathname?.startsWith(route),
  );

  // Sync with the API in the background (only once, and only on authenticated
  // routes). On success, persist the merged result to localStorage and notify
  // the store so subscribers re-read it — no setState inside the effect body.
  useEffect(() => {
    if (!hasSyncedRef.current && !isPublicRoute) {
      hasSyncedRef.current = true;
      fetchSettingsFromAPI().then((apiSettings) => {
        if (apiSettings) {
          // Merge API settings with local (API takes precedence)
          const merged: UserSettings = {
            ...getSettingsSnapshot(),
            ...apiSettings,
            updatedAt: new Date().toISOString(),
          };
          saveUserSettings(merged);
          emitSettingsChange();
        }
      });
    }
  }, [isPublicRoute]);

  const updateSettings = useCallback((updates: UserSettingsUpdate) => {
    // Update localStorage immediately, then notify the store to re-read it.
    saveUserSettings(updates);
    emitSettingsChange();
    // Sync to API in background
    saveSettingsToAPI(updates);
  }, []);

  const value = useMemo(
    () => ({
      settings,
      updateSettings,
      isLoaded,
    }),
    [settings, updateSettings, isLoaded],
  );

  return (
    <UserSettingsContext.Provider value={value}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings(): UserSettingsContextValue {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error(
      "useUserSettings must be used within a UserSettingsProvider",
    );
  }
  return context;
}
