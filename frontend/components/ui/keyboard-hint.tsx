"use client";

import { cn } from "@/lib/utils";
import { useKeyboardUser } from "@/hooks/use-keyboard-user";

interface KeyboardHintProps {
  keys: string;
  className?: string;
}

export function KeyboardHint({ keys, className }: KeyboardHintProps) {
  const isKeyboardUser = useKeyboardUser();

  if (!isKeyboardUser) return null;

  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded px-1 py-0.5",
        "text-[10px] font-mono leading-none",
        "bg-muted text-muted-foreground border border-border",
        "pointer-events-none select-none",
        className,
      )}
    >
      {keys}
    </kbd>
  );
}
