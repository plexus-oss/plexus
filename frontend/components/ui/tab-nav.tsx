"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number | string;
  indicator?: "online" | "offline" | "warning";
}

interface TabNavProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function TabNav({ tabs, activeTab, onTabChange, className }: TabNavProps) {
  return (
    <div className={cn("border-b border-border px-4", className)}>
      <nav className="flex gap-6" aria-label="Tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
            )}
          >
            {tab.indicator && (
              <div
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  tab.indicator === "online" && "bg-green-500",
                  tab.indicator === "offline" && "bg-zinc-400",
                  tab.indicator === "warning" && "bg-yellow-500"
                )}
              />
            )}
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-red-500 text-white">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

// Compact variant for inline/card usage
interface TabToggleProps {
  tabs: { id: string; label: string; icon?: React.ReactNode }[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function TabToggle({ tabs, activeTab, onTabChange, className }: TabToggleProps) {
  return (
    <div className={cn("flex items-center rounded-md border border-border p-0.5", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
            activeTab === tab.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
