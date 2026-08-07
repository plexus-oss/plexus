"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface KeyboardShortcutProps {
  shortcut: string;
  className?: string;
}

/**
 * Displays a keyboard shortcut with proper styling
 * Automatically converts Cmd to Ctrl on non-Mac platforms
 */
export function KeyboardShortcut({
  shortcut,
  className,
}: KeyboardShortcutProps) {
  const isMac = useMemo(() => {
    if (typeof window === "undefined") return true;
    return navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  }, []);

  const keys = useMemo(() => {
    return shortcut.split(/\s*\+\s*|\s+/).map((key) => {
      // Normalize key names
      const normalized = key.toLowerCase();

      if (
        normalized === "cmd" ||
        normalized === "meta" ||
        normalized === "command"
      ) {
        return isMac ? "\u2318" : "Ctrl";
      }
      if (normalized === "ctrl" || normalized === "control") {
        return isMac ? "\u2303" : "Ctrl";
      }
      if (normalized === "alt" || normalized === "option") {
        return isMac ? "\u2325" : "Alt";
      }
      if (normalized === "shift") {
        return isMac ? "\u21E7" : "Shift";
      }
      if (normalized === "enter" || normalized === "return") {
        return isMac ? "\u21A9" : "Enter";
      }
      if (normalized === "backspace" || normalized === "delete") {
        return isMac ? "\u232B" : "Backspace";
      }
      if (normalized === "escape" || normalized === "esc") {
        return "Esc";
      }
      if (normalized === "tab") {
        return isMac ? "\u21E5" : "Tab";
      }
      if (normalized === "space") {
        return "Space";
      }
      if (normalized === "up") return "\u2191";
      if (normalized === "down") return "\u2193";
      if (normalized === "left") return "\u2190";
      if (normalized === "right") return "\u2192";

      // Capitalize single letters
      return key.length === 1 ? key.toUpperCase() : key;
    });
  }, [shortcut, isMac]);

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((key, i) => (
        <kbd key={i}>{key}</kbd>
      ))}
    </span>
  );
}
