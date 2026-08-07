"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { registerHotkeys, type HotkeyConfig } from "@/hooks/use-hotkeys";
import { LIST_NEXT, LIST_PREV, LIST_OPEN } from "@/lib/shortcuts";

export interface UseListNavigationOptions<T> {
  items: T[];
  onSelect?: (item: T, index: number) => void;
  onOpen?: (item: T, index: number) => void;
  enabled?: boolean;
}

export interface UseListNavigationReturn {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  activeRef: React.RefObject<HTMLElement | null>;
}

export function useListNavigation<T>({
  items,
  onSelect,
  onOpen,
  enabled = true,
}: UseListNavigationOptions<T>): UseListNavigationReturn {
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeRef = useRef<HTMLElement | null>(null);

  // Auto-scroll active item into view
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [activeIndex]);

  // Clamp activeIndex when items change (adjust-state-during-render; guards
  // ensure the setState only fires when the value actually changes).
  if (items.length === 0) {
    if (activeIndex !== -1) setActiveIndex(-1);
  } else if (activeIndex >= items.length) {
    setActiveIndex(items.length - 1);
  }

  const moveNext = useCallback(() => {
    if (items.length === 0) return;
    setActiveIndex((prev) => {
      const next = prev < items.length - 1 ? prev + 1 : prev;
      onSelect?.(items[next], next);
      return next;
    });
  }, [items, onSelect]);

  const movePrev = useCallback(() => {
    if (items.length === 0) return;
    setActiveIndex((prev) => {
      const next = prev > 0 ? prev - 1 : 0;
      onSelect?.(items[next], next);
      return next;
    });
  }, [items, onSelect]);

  const openItem = useCallback(() => {
    if (activeIndex >= 0 && activeIndex < items.length) {
      onOpen?.(items[activeIndex], activeIndex);
    }
  }, [activeIndex, items, onOpen]);

  // Register hotkeys
  useEffect(() => {
    if (!enabled || !LIST_NEXT || !LIST_PREV) return;

    const configs: HotkeyConfig[] = [
      {
        key: LIST_NEXT,
        callback: moveNext,
        description: "Next item",
        category: "action",
        enabled,
      },
      {
        key: LIST_PREV,
        callback: movePrev,
        description: "Previous item",
        category: "action",
        enabled,
      },
    ];

    if (LIST_OPEN) {
      configs.push({
        key: LIST_OPEN,
        callback: openItem,
        description: "Open item",
        category: "action",
        enabled,
      });
    }

    const unregister = registerHotkeys(configs);
    return unregister;
  }, [enabled, moveNext, movePrev, openItem]);

  return { activeIndex, setActiveIndex, activeRef };
}
