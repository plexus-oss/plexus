"use client";

import { Button } from "@/components/ui/button";

interface TimeFormatToggleProps {
  value: boolean;
  onChange: (use12Hour: boolean) => void;
}

export function TimeFormatToggle({ value, onChange }: TimeFormatToggleProps) {
  return (
    <div className="flex gap-2">
      <Button
        variant={value ? "default" : "outline"}
        onClick={() => onChange(true)}
        className="flex-1 h-9 text-xs"
      >
        12-hour
      </Button>
      <Button
        variant={!value ? "default" : "outline"}
        onClick={() => onChange(false)}
        className="flex-1 h-9 text-xs"
      >
        24-hour
      </Button>
    </div>
  );
}
