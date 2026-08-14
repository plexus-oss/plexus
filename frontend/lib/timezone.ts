export interface TimezoneOption {
  value: string;
  label: string;
  offset: string;
  region: string;
}

export function formatTimeInZone(
  date: Date,
  timezone: string,
  use12Hour: boolean = false,
  showSeconds: boolean = false,
  /** Sub-second digits ("12:04:31.25"); implies seconds. For deep chart zoom. */
  fractionalSecondDigits?: 1 | 2 | 3
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: showSeconds || fractionalSecondDigits ? "2-digit" : undefined,
    fractionalSecondDigits,
    hour12: use12Hour,
  }).format(date);
}

export function getTimezoneAbbr(timezone: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timezone;
}

export function formatDateTimeInZone(
  date: Date,
  timezone: string,
  use12Hour: boolean = false
): string {
  const dateStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: use12Hour,
  }).format(date);
  return `${dateStr} ${timeStr}`;
}

export function formatDateInZone(
  date: Date,
  timezone: string,
  format: "short" | "medium" | "long" = "medium"
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: format === "short" ? "short" : "long",
    day: "numeric",
    year: format === "long" ? "numeric" : undefined,
  }).format(date);
}

export function convertToTimezone(date: Date, timezone: string): Date {
  return new Date(date.toLocaleString("en-US", { timeZone: timezone }));
}

export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function getTimezoneOffsetHours(timezone: string, date: Date): number {
  const tzDate = new Date(date.toLocaleString("en-US", { timeZone: timezone }));
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60 * 60);
}

function formatOffset(offsetHours: number): string {
  if (offsetHours === 0) return "UTC";
  const sign = offsetHours > 0 ? "+" : "";
  const hours = Math.floor(Math.abs(offsetHours));
  const minutes = Math.abs((offsetHours % 1) * 60);
  if (minutes === 0) return `UTC${sign}${offsetHours}`;
  return `UTC${sign}${hours}:${minutes.toString().padStart(2, "0")}`;
}

const COMMON_TIMEZONES: Array<Omit<TimezoneOption, "offset">> = [
  { value: "UTC", label: "UTC", region: "UTC" },
  { value: "America/New_York", label: "New York", region: "Americas" },
  { value: "America/Chicago", label: "Chicago", region: "Americas" },
  { value: "America/Denver", label: "Denver", region: "Americas" },
  { value: "America/Los_Angeles", label: "Los Angeles", region: "Americas" },
  { value: "America/Anchorage", label: "Anchorage", region: "Americas" },
  { value: "Pacific/Honolulu", label: "Honolulu", region: "Americas" },
  { value: "America/Toronto", label: "Toronto", region: "Americas" },
  { value: "America/Mexico_City", label: "Mexico City", region: "Americas" },
  { value: "America/Sao_Paulo", label: "São Paulo", region: "Americas" },
  { value: "America/Buenos_Aires", label: "Buenos Aires", region: "Americas" },
  { value: "Europe/London", label: "London", region: "Europe" },
  { value: "Europe/Paris", label: "Paris", region: "Europe" },
  { value: "Europe/Berlin", label: "Berlin", region: "Europe" },
  { value: "Europe/Rome", label: "Rome", region: "Europe" },
  { value: "Europe/Madrid", label: "Madrid", region: "Europe" },
  { value: "Europe/Amsterdam", label: "Amsterdam", region: "Europe" },
  { value: "Europe/Brussels", label: "Brussels", region: "Europe" },
  { value: "Europe/Vienna", label: "Vienna", region: "Europe" },
  { value: "Europe/Stockholm", label: "Stockholm", region: "Europe" },
  { value: "Europe/Moscow", label: "Moscow", region: "Europe" },
  { value: "Asia/Dubai", label: "Dubai", region: "Asia" },
  { value: "Asia/Kolkata", label: "Mumbai", region: "Asia" },
  { value: "Asia/Shanghai", label: "Shanghai", region: "Asia" },
  { value: "Asia/Hong_Kong", label: "Hong Kong", region: "Asia" },
  { value: "Asia/Tokyo", label: "Tokyo", region: "Asia" },
  { value: "Asia/Seoul", label: "Seoul", region: "Asia" },
  { value: "Asia/Singapore", label: "Singapore", region: "Asia" },
  { value: "Asia/Bangkok", label: "Bangkok", region: "Asia" },
  { value: "Asia/Jakarta", label: "Jakarta", region: "Asia" },
  { value: "Australia/Sydney", label: "Sydney", region: "Pacific" },
  { value: "Australia/Melbourne", label: "Melbourne", region: "Pacific" },
  { value: "Australia/Perth", label: "Perth", region: "Pacific" },
  { value: "Pacific/Auckland", label: "Auckland", region: "Pacific" },
  { value: "Pacific/Fiji", label: "Fiji", region: "Pacific" },
  { value: "Africa/Cairo", label: "Cairo", region: "Africa" },
  { value: "Africa/Johannesburg", label: "Johannesburg", region: "Africa" },
  { value: "Africa/Lagos", label: "Lagos", region: "Africa" },
];

export function getCommonTimezones(): TimezoneOption[] {
  const now = new Date();
  return COMMON_TIMEZONES.map((tz) => ({
    ...tz,
    offset: formatOffset(getTimezoneOffsetHours(tz.value, now)),
  }));
}
