"use client";

/**
 * Plexus Terminal — the ⌘K side panel. A thin Sheet wrapper around the shared
 * TerminalConversation (the same component the full /terminal page renders).
 *
 * Besides ⌘K, any client component can open it programmatically — optionally
 * pre-seeded with a first message that sends immediately (e.g. the chart
 * toolbar's "Explain" button) — via openTerminal().
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Maximize2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TerminalConversation, ACCENT } from "@/components/assistant/terminal-conversation";

/** Window event the mounted Terminal listens for (detail: {message?}). */
const OPEN_EVENT = "plexus:terminal-open";

/**
 * Open the global Terminal sheet from anywhere in the product tree. With a
 * message, the new session starts by sending it — same UX as typing it after
 * ⌘K, no special styling or mode.
 */
export function openTerminal(message?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { message } }));
}

export function Terminal() {
  const [open, setOpen] = useState(false);
  // First message to auto-send when opened programmatically (null for ⌘K).
  const [seed, setSeed] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSeed(null);
        setOpen((v) => !v);
      }
    };
    const onOpen = (e: Event) => {
      const message = (e as CustomEvent<{ message?: string }>).detail?.message;
      setSeed(typeof message === "string" && message.trim() ? message : null);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSeed(null);
      }}
    >
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
        {/* Remount per-open so each session starts clean; key on the seed so a
            programmatic open while already open starts a fresh seeded session. */}
        {open && (
          <TerminalConversation
            key={seed ?? "blank"}
            variant="panel"
            initialMessage={seed ?? undefined}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
