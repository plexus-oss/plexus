"use client";

import { AnimatePresence, motion } from "framer-motion";

interface ResizeIndicatorProps {
  visible: boolean;
  width: number;
  height: number;
}

/**
 * Overlay showing grid dimensions (e.g. "6 x 4") during panel resize.
 * Rendered as a fixed-position badge near the bottom-right of the grid.
 */
export function ResizeIndicator({
  visible,
  width,
  height,
}: ResizeIndicatorProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.12 }}
          className="fixed bottom-4 right-4 z-50 px-3 py-1.5 rounded-md bg-foreground text-background text-xs font-mono font-medium shadow-lg pointer-events-none"
        >
          {width} &times; {height}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
