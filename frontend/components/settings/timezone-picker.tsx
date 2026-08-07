"use client";

import { useMemo } from "react";
import { Globe } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCommonTimezones, TimezoneOption } from "@/lib/timezone";

interface TimezonePickerProps {
  value: string;
  onChange: (timezone: string) => void;
  size?: "sm" | "default";
}

export function TimezonePicker({ value, onChange, size = "default" }: TimezonePickerProps) {
  const timezones = useMemo(() => getCommonTimezones(), []);

  // Group timezones by region
  const groupedTimezones = useMemo(() => {
    const groups: Record<string, TimezoneOption[]> = {};
    timezones.forEach((tz) => {
      if (!groups[tz.region]) {
        groups[tz.region] = [];
      }
      groups[tz.region].push(tz);
    });
    return groups;
  }, [timezones]);

  const selectedTimezone = timezones.find((tz) => tz.value === value);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size={size} className="w-full">
        <SelectValue>
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              {selectedTimezone
                ? `${selectedTimezone.label} (${selectedTimezone.offset})`
                : "Select timezone"}
            </span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(groupedTimezones).map(([region, tzList]) => (
          <SelectGroup key={region}>
            <SelectLabel>{region}</SelectLabel>
            {tzList.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                <span className="flex items-center justify-between w-full gap-4">
                  <span>{tz.label}</span>
                  <span className="text-muted-foreground text-xs">{tz.offset}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
