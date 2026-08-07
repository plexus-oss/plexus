"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { KeyboardShortcut } from "@/components/ui/keyboard-shortcut";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

interface SaveBarProps {
  saveStatus: SaveStatus;
  onSave: () => void;
  onDiscard: () => void;
}

export function SaveBar({ saveStatus, onSave, onDiscard }: SaveBarProps) {
  const visible = saveStatus === "pending" || saveStatus === "saving";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.15 }}
          className="fixed bottom-6 z-40 flex items-center gap-3 rounded-lg border bg-popover px-4 py-2.5 shadow-lg"
          style={{
            left: "calc(35% + var(--nav-width, 0px) / 2)",
            transform: "translateX(-50%)",
          } as React.CSSProperties}
        >
          <span className="text-sm font-medium">Unsaved changes</span>

          <div className="h-4 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={saveStatus === "saving"}
          >
            Discard
          </Button>
          <Button size="sm" onClick={onSave} disabled={saveStatus === "saving"}>
            {saveStatus === "saving" ? (
              <>
                <Spinner className="h-3 w-3 mr-1.5" />
                Saving…
              </>
            ) : (
              <>
                Save
                <KeyboardShortcut shortcut="cmd s" />
              </>
            )}
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
