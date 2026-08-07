"use client";

/**
 * AdvancedGroup — collapsed-by-default container for panel settings a
 * first-time user wouldn't touch in their first minute. Keeps each config
 * section's visible surface to its essentials (progressive disclosure).
 */

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function AdvancedGroup({
  label = "Advanced",
  defaultOpen = false,
  children,
}: {
  label?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 w-full text-left group">
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">
          {label}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pl-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
