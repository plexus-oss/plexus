import { Badge } from "@/components/ui/badge";

interface Props {
  deviceType: string | null | undefined;
  /** True when this device persists telemetry to ClickHouse. */
  recording: boolean;
  status: "online" | "offline" | "unknown" | "pending" | "error" | null;
  linkedCount: number;
}

/** Pick the single most relevant mode label for this device. */
function resolveMode(props: Props): string | null {
  if (props.recording) return "Recording";
  if (props.status === "online") return "Live only";
  if (props.linkedCount > 0) return "External";
  if (props.deviceType === "satellite") return "Orbital";
  return null;
}

export function DeviceModeBadge(props: Props) {
  const label = resolveMode(props);
  if (!label) return null;
  return (
    <Badge variant="secondary" className="text-[10px]">
      {label}
    </Badge>
  );
}
