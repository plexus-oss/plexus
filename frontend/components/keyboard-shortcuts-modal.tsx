"use client";

import { useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getRegisteredHotkeys, HotkeyConfig } from "@/hooks/use-hotkeys";
import { KeyboardShortcut } from "@/components/ui/keyboard-shortcut";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const categoryLabels: Record<HotkeyConfig["category"], string> = {
  navigation: "Navigation",
  action: "Actions",
  general: "General",
};

const categoryOrder: HotkeyConfig["category"][] = [
  "general",
  "navigation",
  "action",
];

// Static shortcuts that are always available
const staticShortcuts: HotkeyConfig[] = [
  {
    key: "escape",
    description: "Close modal / Cancel edit",
    category: "general",
    callback: () => {},
  },
  {
    key: "enter",
    description: "Save / Confirm",
    category: "general",
    callback: () => {},
  },
  {
    key: "?",
    description: "Show keyboard shortcuts",
    category: "general",
    callback: () => {},
  },
];

export function KeyboardShortcutsModal({
  isOpen,
  onClose,
}: KeyboardShortcutsModalProps) {
  // Snapshot the registered hotkeys whenever the modal opens.
  const dynamicHotkeys = useMemo<HotkeyConfig[]>(
    () => (isOpen ? getRegisteredHotkeys() : []),
    [isOpen],
  );

  // Combine static and dynamic, removing duplicates
  const allHotkeys = useMemo(() => {
    const staticKeys = new Set(staticShortcuts.map((s) => s.key.toLowerCase()));
    const filtered = dynamicHotkeys.filter(
      (h) => !staticKeys.has(h.key.toLowerCase()),
    );
    return [...staticShortcuts, ...filtered];
  }, [dynamicHotkeys]);

  // Group by category
  const groupedHotkeys = useMemo(() => {
    const groups: Record<HotkeyConfig["category"], HotkeyConfig[]> = {
      navigation: [],
      action: [],
      general: [],
    };

    allHotkeys.forEach((hotkey) => {
      groups[hotkey.category].push(hotkey);
    });

    return groups;
  }, [allHotkeys]);

  // Handle escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed inset-x-0 top-[10%] z-50 mx-auto w-full max-w-2xl px-4"
          >
            <div className="bg-popover border rounded-lg shadow-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="flex items-center gap-2">
                  <Keyboard className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-medium">Keyboard Shortcuts</h2>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="text-muted-foreground hover:text-foreground h-auto w-auto p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Content */}
              <div className="p-4 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {categoryOrder.map((category) => {
                    const hotkeys = groupedHotkeys[category];
                    if (hotkeys.length === 0) return null;

                    return (
                      <div key={category}>
                        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                          {categoryLabels[category]}
                        </h3>
                        <div className="space-y-2">
                          {hotkeys.map((hotkey, idx) => (
                            <div
                              key={`${hotkey.key}-${idx}`}
                              className="flex items-center justify-between py-1.5"
                            >
                              <span className="text-sm text-foreground">
                                {hotkey.description}
                              </span>
                              <KeyboardShortcut
                                shortcut={hotkey.key}
                                className="ml-4"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Tips */}
                <div className="mt-6 pt-4 border-t">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Tips
                  </h3>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>
                      Press{" "}
                      <KeyboardShortcut
                        shortcut="n"
                        className="inline-flex mx-1"
                      />{" "}
                      to create a new dashboard
                    </li>
                    <li>
                      Press{" "}
                      <KeyboardShortcut
                        shortcut="escape"
                        className="inline-flex mx-1"
                      />{" "}
                      to cancel any action or close modals
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
