"use client";

import { cn } from "@/lib/utils";

type ThemeKind = "light" | "dark" | "system" | "fun";

interface ThemeCardProps {
  theme: ThemeKind;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}

export function ThemeCard({
  theme,
  label,
  icon,
  active,
  onClick,
}: ThemeCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 rounded-lg border-2 p-3 transition-all text-left",
        active
          ? "border-primary bg-primary/5"
          : "border-border hover:border-border/80 hover:bg-muted/30",
      )}
    >
      {/* Mini preview */}
      <div
        className={cn(
          "rounded-md h-16 mb-2 overflow-hidden border",
          theme === "light"
            ? "bg-white border-gray-200"
            : theme === "dark"
              ? "bg-zinc-900 border-zinc-700"
              : theme === "fun"
                ? "bg-[#f4efe6] border-[#0e0e0c]/15"
                : "bg-gradient-to-r from-white to-zinc-900 border-gray-300",
        )}
      >
        {theme === "fun" ? (
          <div className="h-full w-full flex items-center justify-center">
            <span
              className="text-2xl leading-none lowercase text-[#0e0e0c]"
              style={{
                fontFamily:
                  "var(--font-bagel-fat-one), 'Instrument Serif', Georgia, serif",
              }}
            >
              aa<span className="text-[oklch(70%_0.2_18)]">.</span>
            </span>
          </div>
        ) : (
          <div className="p-1.5 space-y-1">
            <div
              className={cn(
                "h-1.5 w-8 rounded-full",
                theme === "light"
                  ? "bg-gray-200"
                  : theme === "dark"
                    ? "bg-zinc-700"
                    : "bg-gray-400",
              )}
            />
            <div
              className={cn(
                "h-1.5 w-12 rounded-full",
                theme === "light"
                  ? "bg-gray-100"
                  : theme === "dark"
                    ? "bg-zinc-800"
                    : "bg-gray-300",
              )}
            />
            <div
              className={cn(
                "h-1.5 w-6 rounded-full",
                theme === "light"
                  ? "bg-gray-200"
                  : theme === "dark"
                    ? "bg-zinc-700"
                    : "bg-gray-400",
              )}
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "w-3 h-3 rounded-full border-2 flex items-center justify-center",
            active ? "border-primary" : "border-muted-foreground/30",
          )}
        >
          {active && (
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
      </div>
    </button>
  );
}
