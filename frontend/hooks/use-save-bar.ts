"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { toast } from "@/lib/toast-utils";
import type { SaveStatus } from "@/components/ui/save-bar";

interface UseSaveBarOptions {
  /** Called when user clicks Save or presses Cmd+S */
  onSave: () => Promise<void>;
  /** Called when user clicks Discard */
  onDiscard: () => void;
  /** Current page path prefix for same-page navigation detection */
  currentPath?: string;
  /** Whether saving is enabled (e.g. role check). Default: true */
  enabled?: boolean;
  /** Label for success toast. Default: "Saved" */
  successMessage?: string;
  /** Label for error toast. Default: "Failed to save" */
  errorMessage?: string;
}

interface UseSaveBarReturn {
  saveStatus: SaveStatus;
  /** Call when any field changes to mark form as dirty */
  markDirty: () => void;
  /** Reset to idle (e.g. when server data re-initializes) */
  reset: () => void;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Props to spread onto <SaveBar /> */
  saveBarProps: {
    saveStatus: SaveStatus;
    onSave: () => void;
    onDiscard: () => void;
  };
  /** Leave confirmation dialog state */
  leaveConfirm: {
    isOpen: boolean;
    onStay: () => void;
    onLeave: () => void;
  };
}

export function useSaveBar({
  onSave,
  onDiscard,
  currentPath,
  enabled = true,
  successMessage = "Saved",
  errorMessage = "Failed to save",
}: UseSaveBarOptions): UseSaveBarReturn {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const pendingNavigationRef = useRef<string | null>(null);
  const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onSaveRef = useRef(onSave);
  const onDiscardRef = useRef(onDiscard);

  // Keep refs up to date
  useEffect(() => {
    onSaveRef.current = onSave;
    onDiscardRef.current = onDiscard;
  });

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  const markDirty = useCallback(() => {
    setSaveStatus("pending");
  }, []);

  const reset = useCallback(() => {
    setSaveStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      await onSaveRef.current();
      setSaveStatus("saved");
      toast.success(successMessage);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("error");
      toast.error(errorMessage);
    }
  }, [successMessage, errorMessage]);

  const handleDiscard = useCallback(() => {
    onDiscardRef.current();
    setSaveStatus("idle");
  }, []);

  // Cmd+S hotkey
  useHotkeys(
    [
      {
        key: "cmd s",
        description: "Save changes",
        category: "action",
        callback: handleSave,
        enabled: () => enabled && saveStatus === "pending",
        preventDefault: true,
      },
    ],
    [handleSave, enabled, saveStatus],
  );

  // Warn on browser close/refresh with unsaved changes
  useEffect(() => {
    if (saveStatus !== "pending") return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveStatus]);

  // Intercept Next.js client-side navigations when dirty
  useEffect(() => {
    if (saveStatus !== "pending" || !currentPath) return;

    const originalPushState = window.history.pushState.bind(window.history);

    window.history.pushState = function (
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      const target = url?.toString() ?? "";
      if (target && !target.startsWith(currentPath)) {
        pendingNavigationRef.current = target;
        setShowLeaveConfirm(true);
        return;
      }
      originalPushState(data, unused, url);
    };

    return () => {
      window.history.pushState = originalPushState;
    };
  }, [saveStatus, currentPath]);

  const handleStay = useCallback(() => {
    setShowLeaveConfirm(false);
    pendingNavigationRef.current = null;
  }, []);

  const handleLeave = useCallback(() => {
    setSaveStatus("idle");
    setShowLeaveConfirm(false);
    if (pendingNavigationRef.current) {
      // Use raw pushState to avoid our interceptor (which is cleaned up when status goes idle)
      window.history.pushState(null, "", pendingNavigationRef.current);
      // Trigger Next.js to handle the navigation
      window.dispatchEvent(new PopStateEvent("popstate"));
      pendingNavigationRef.current = null;
    }
  }, []);

  return {
    saveStatus,
    markDirty,
    reset,
    isDirty: saveStatus === "pending",
    saveBarProps: {
      saveStatus,
      onSave: handleSave,
      onDiscard: handleDiscard,
    },
    leaveConfirm: {
      isOpen: showLeaveConfirm,
      onStay: handleStay,
      onLeave: handleLeave,
    },
  };
}
