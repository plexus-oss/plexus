"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
  label,
  badge,
  defaultOpen = true,
  children,
}: {
  label: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full pb-1.5 border-b border-border/30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
          {badge}
        </div>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function LabelValueRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between py-1.5",
        !last && "border-b border-border/10",
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono">{value}</span>
    </div>
  );
}

/** Parse international designator from TLE line 1 (chars 9-17) */
export function parseIntlDesignator(tleLine1: string): string | null {
  const raw = tleLine1.substring(9, 17).trim();
  if (!raw || raw.length < 4) return null;
  const year2 = raw.substring(0, 2);
  const launch = raw.substring(2, 5).trim();
  const piece = raw.substring(5).trim();
  const year = parseInt(year2) >= 57 ? `19${year2}` : `20${year2}`;
  return `${year}-${launch}${piece}`;
}
