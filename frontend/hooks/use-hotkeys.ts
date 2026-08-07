"use client";

import { useEffect, useRef } from "react";

export interface HotkeyConfig {
  key: string; // e.g., "g d", "cmd+s", "?"
  callback: () => void;
  description: string;
  category: "navigation" | "action" | "general";
  enabled?: boolean | (() => boolean);
  preventDefault?: boolean;
}

interface ParsedHotkey {
  sequence: string[]; // For sequences like ["g", "d"]
  modifiers: {
    meta: boolean;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
  };
  key: string;
  isSequence: boolean;
}

function parseHotkey(hotkey: string): ParsedHotkey {
  const parts = hotkey.toLowerCase().split(/\s+/);

  // Check if it's a sequence (multiple keys without modifiers)
  if (
    parts.length > 1 &&
    !parts.some((p) => ["cmd", "ctrl", "alt", "shift", "meta"].includes(p))
  ) {
    return {
      sequence: parts,
      modifiers: { meta: false, ctrl: false, alt: false, shift: false },
      key: "",
      isSequence: true,
    };
  }

  // Single key or modifier combo
  const modifiers = {
    meta: false,
    ctrl: false,
    alt: false,
    shift: false,
  };

  let finalKey = "";

  for (const part of parts) {
    if (part === "cmd" || part === "meta" || part === "command") {
      modifiers.meta = true;
    } else if (part === "ctrl" || part === "control") {
      modifiers.ctrl = true;
    } else if (part === "alt" || part === "option") {
      modifiers.alt = true;
    } else if (part === "shift") {
      modifiers.shift = true;
    } else {
      finalKey = part;
    }
  }

  return {
    sequence: [],
    modifiers,
    key: finalKey,
    isSequence: false,
  };
}

function normalizeKey(key: string | undefined): string {
  if (!key) return "";
  const keyMap: Record<string, string> = {
    " ": "space",
    Escape: "escape",
    Enter: "enter",
    Backspace: "backspace",
    Delete: "delete",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Tab: "tab",
  };
  return keyMap[key] || key.toLowerCase();
}

function isInputElement(element: Element | null): boolean {
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }
  if (element.getAttribute("contenteditable") === "true") {
    return true;
  }
  return false;
}

// Global hotkey registry
const hotkeyRegistry = new Map<string, HotkeyConfig>();
const listeners: Set<() => void> = new Set();

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

export function registerHotkeys(configs: HotkeyConfig[]) {
  configs.forEach((config) => {
    hotkeyRegistry.set(config.key.toLowerCase(), config);
  });
  notifyListeners();
  return () => {
    configs.forEach((config) => {
      hotkeyRegistry.delete(config.key.toLowerCase());
    });
    notifyListeners();
  };
}

export function getRegisteredHotkeys(): HotkeyConfig[] {
  return Array.from(hotkeyRegistry.values());
}

export function useHotkeyListener() {
  const sequenceBufferRef = useRef<string[]>([]);
  const sequenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = normalizeKey(e.key);
      if (!key) return;
      const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
      const inInput = isInputElement(document.activeElement);

      // Skip plain keys in input elements (unless Escape)
      if (inInput && !hasModifier && e.key !== "Escape") {
        return;
      }

      // Check for modifier-based hotkeys first
      if (hasModifier) {
        for (const [hotkeyKey, config] of hotkeyRegistry) {
          const parsed = parseHotkey(hotkeyKey);
          if (parsed.isSequence) continue;

          const enabled =
            config.enabled === undefined
              ? true
              : typeof config.enabled === "function"
                ? config.enabled()
                : config.enabled;

          if (!enabled) continue;

          const modifiersMatch =
            parsed.modifiers.meta === e.metaKey &&
            parsed.modifiers.ctrl === e.ctrlKey &&
            parsed.modifiers.alt === e.altKey &&
            parsed.modifiers.shift === e.shiftKey;

          if (modifiersMatch && parsed.key === key) {
            if (config.preventDefault !== false) {
              e.preventDefault();
            }
            config.callback();
            return;
          }
        }
      }

      // Handle sequences (no modifiers)
      if (!hasModifier && !e.shiftKey) {
        // Clear sequence timeout
        if (sequenceTimeoutRef.current) {
          clearTimeout(sequenceTimeoutRef.current);
        }

        // Add to buffer
        sequenceBufferRef.current.push(key);

        // Check for matching sequence
        const currentSequence = sequenceBufferRef.current.join(" ");

        for (const [hotkeyKey, config] of hotkeyRegistry) {
          const parsed = parseHotkey(hotkeyKey);
          if (!parsed.isSequence) continue;

          const enabled =
            config.enabled === undefined
              ? true
              : typeof config.enabled === "function"
                ? config.enabled()
                : config.enabled;

          if (!enabled) continue;

          const hotkeySequence = parsed.sequence.join(" ");

          if (hotkeySequence === currentSequence) {
            if (config.preventDefault !== false) {
              e.preventDefault();
            }
            config.callback();
            sequenceBufferRef.current = [];
            return;
          }
        }

        // Check for single-key hotkeys (like "?", "n", "/")
        if (sequenceBufferRef.current.length === 1) {
          for (const [hotkeyKey, config] of hotkeyRegistry) {
            const parsed = parseHotkey(hotkeyKey);
            if (parsed.isSequence) continue;
            if (
              parsed.modifiers.meta ||
              parsed.modifiers.ctrl ||
              parsed.modifiers.alt
            )
              continue;

            const enabled =
              config.enabled === undefined
                ? true
                : typeof config.enabled === "function"
                  ? config.enabled()
                  : config.enabled;

            if (!enabled) continue;

            // Handle shift for special characters like "?"
            const keyToMatch = e.shiftKey ? e.key.toLowerCase() : key;
            if (parsed.key === keyToMatch || parsed.key === key) {
              if (config.preventDefault !== false) {
                e.preventDefault();
              }
              config.callback();
              sequenceBufferRef.current = [];
              return;
            }
          }
        }

        // Set timeout to clear buffer
        sequenceTimeoutRef.current = setTimeout(() => {
          sequenceBufferRef.current = [];
        }, 800); // 800ms to complete sequence
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (sequenceTimeoutRef.current) {
        clearTimeout(sequenceTimeoutRef.current);
      }
    };
  }, []);
}

// Hook to register hotkeys for a component
export function useHotkeys(
  configs: HotkeyConfig[],
  deps: React.DependencyList = [],
) {
  useEffect(() => {
    const unregister = registerHotkeys(configs);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
