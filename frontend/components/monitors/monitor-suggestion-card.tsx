"use client";

import { Activity, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MonitorSuggestionCardProps {
  metric: string;
  rationale: string;
  onCreateMonitor: () => void;
  onDismiss: () => void;
}

export function MonitorSuggestionCard({
  metric,
  rationale,
  onCreateMonitor,
  onDismiss,
}: MonitorSuggestionCardProps) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/20 border-l-2 border-l-violet-500/50">
      <Activity className="h-4 w-4 text-violet-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{metric}</div>
        <p className="text-xs text-muted-foreground mt-0.5">{rationale}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={onCreateMonitor}
          className="h-6 text-[10px] mt-2 rounded-full"
        >
          Create Monitor
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        className="h-6 w-6 flex-shrink-0"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
