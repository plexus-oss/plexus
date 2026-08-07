"use client";

/**
 * Plexus Terminal — the ⌘K side panel. A thin Sheet wrapper around the shared
 * TerminalConversation (the same component the full /terminal page renders).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Maximize2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TerminalConversation, ACCENT } from "@/components/assistant/terminal-conversation";

export function Terminal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 bg-background p-0 sm:max-w-lg"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3 font-mono">
          <span style={{ color: ACCENT }}>❯</span>
          <span className="text-[13px] font-medium text-foreground">Plexus Terminal</span>
          <div className="ml-auto flex items-center gap-3 text-muted-foreground">
            <Link
              href="/terminal"
              onClick={() => setOpen(false)}
              aria-label="Open Terminal as a full page"
              className="opacity-70 transition-opacity hover:opacity-100"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Link>
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </div>
        </div>
        {/* Remount per-open so each session starts clean. */}
        {open && <TerminalConversation variant="panel" />}
      </SheetContent>
    </Sheet>
  );
}
