"use client";

import { useCallback, useMemo } from "react";
import { useUserSettings } from "@/context/user-settings-context";
import {
  formatTimeInZone,
  formatDateTimeInZone,
  formatDateInZone,
} from "@/lib/timezone";

interface FormattedTimeUtils {
  /** Format time only (e.g., "2:30 PM" or "14:30") */
  formatTime: (date: Date | string | number) => string;
  /** Format date and time (e.g., "Jan 15, 2025 2:30 PM") */
  formatDateTime: (date: Date | string | number) => string;
  /** Format date only (e.g., "Jan 15, 2025") */
  formatDate: (
    date: Date | string | number,
    format?: "short" | "medium" | "long",
  ) => string;
  /** Get the user's timezone */
  timezone: string;
  /** Whether user prefers 12-hour format */
  use12Hour: boolean;
  /** Short timezone (e.g., "EST") */
  shortTimeZone: string;
}

function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

/**
 * Hook that provides time formatting functions using the user's timezone and format preferences
 */
export function useFormattedTime(): FormattedTimeUtils {
  const { settings } = useUserSettings();
  const { timezone, use12HourFormat } = settings;

  const formatTime = useCallback(
    (date: Date | string | number) => {
      return formatTimeInZone(toDate(date), timezone, use12HourFormat);
    },
    [timezone, use12HourFormat],
  );

  const formatDateTime = useCallback(
    (date: Date | string | number) => {
      return formatDateTimeInZone(toDate(date), timezone, use12HourFormat);
    },
    [timezone, use12HourFormat],
  );

  const formatDate = useCallback(
    (
      date: Date | string | number,
      format: "short" | "medium" | "long" = "medium",
    ) => {
      return formatDateInZone(toDate(date), timezone, format);
    },
    [timezone],
  );

  const shortTimeZone = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return (
      parts.find((part) => part.type === "timeZoneName")?.value ?? timezone
    );
  }, [timezone]);

  return useMemo(
    () => ({
      formatTime,
      formatDateTime,
      formatDate,
      timezone,
      use12Hour: use12HourFormat,
      shortTimeZone,
    }),
    [
      formatTime,
      formatDateTime,
      formatDate,
      timezone,
      use12HourFormat,
      shortTimeZone,
    ],
  );
}
