"use client";

import { Plus } from "lucide-react";
import { KeyboardHint } from "@/components/ui/keyboard-hint";
import { ACTION_ADD_PANEL } from "@/lib/shortcuts";

interface EmptyDashboardStateProps {
  onAddPanel: () => void;
}

export function EmptyDashboardState({ onAddPanel }: EmptyDashboardStateProps) {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="max-w-sm w-full space-y-6 text-center">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            Start building
          </h2>
          <p className="text-sm text-muted-foreground">
            Add panels to visualize your devices and databases
          </p>
        </div>

        <button
          onClick={onAddPanel}
          className="group w-full flex flex-col items-center gap-3 p-5 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all"
        >
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
            <Plus className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">
              Add a panel
            </div>
            <div className="text-[11px] text-muted-foreground">
              Charts, stats, tables & more — from devices or your database
            </div>
          </div>
          <KeyboardHint keys={ACTION_ADD_PANEL} />
        </button>
      </div>
    </div>
  );
}
