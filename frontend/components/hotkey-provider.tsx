"use client";

import { ReactNode, useState, useEffect } from "react";
import {
  useHotkeyListener,
  registerHotkeys,
  HotkeyConfig,
} from "@/hooks/use-hotkeys";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal";
import { SHOW_SHORTCUTS } from "@/lib/shortcuts";

interface HotkeyProviderProps {
  children: ReactNode;
}

export function HotkeyProvider({ children }: HotkeyProviderProps) {
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // Initialize the global hotkey listener
  useHotkeyListener();

  // Check if any modal is open (to disable certain hotkeys)
  const isModalOpen = showShortcutsModal;

  // Register global hotkeys. Page-level shortcuts are registered by each page
  // via useHotkeys.
  useEffect(() => {
    const globalHotkeys: HotkeyConfig[] = [
      // "?" shows shortcuts modal - handled here for the modal state
      {
        key: SHOW_SHORTCUTS,
        description: "Show keyboard shortcuts",
        category: "general",
        callback: () => setShowShortcutsModal(true),
        enabled: () => !isModalOpen,
      },
    ];

    const unregister = registerHotkeys(globalHotkeys);
    return unregister;
  }, [isModalOpen]);

  return (
    <>
      {children}
      <KeyboardShortcutsModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />
    </>
  );
}
