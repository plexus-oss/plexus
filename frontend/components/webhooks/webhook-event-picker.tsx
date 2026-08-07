"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { WebhookEventType } from "@/lib/db/types";

interface WebhookEventPickerProps {
  value: WebhookEventType[];
  onChange: (events: WebhookEventType[]) => void;
}

const EVENT_CATEGORIES = [
  {
    name: "Alerts",
    events: [
      {
        type: "alert.triggered" as WebhookEventType,
        label: "Alert Triggered",
        description: "When a new alert is created",
      },
      {
        type: "alert.resolved" as WebhookEventType,
        label: "Alert Resolved",
        description: "When an alert is marked as resolved",
      },
      {
        type: "alert.acknowledged" as WebhookEventType,
        label: "Alert Acknowledged",
        description: "When an alert is acknowledged",
      },
    ],
  },
  {
    name: "Device Status",
    events: [
      {
        type: "device.online" as WebhookEventType,
        label: "Device Online",
        description: "When a device comes online",
      },
      {
        type: "device.offline" as WebhookEventType,
        label: "Device Offline",
        description: "When a device goes offline",
      },
    ],
  },
  {
    name: "Thresholds",
    events: [
      {
        type: "threshold.warning" as WebhookEventType,
        label: "Warning Threshold",
        description: "When a metric crosses a warning threshold",
      },
      {
        type: "threshold.critical" as WebhookEventType,
        label: "Critical Threshold",
        description: "When a metric crosses a critical threshold",
      },
    ],
  },
];

export function WebhookEventPicker({
  value,
  onChange,
}: WebhookEventPickerProps) {
  const toggleEvent = (event: WebhookEventType) => {
    if (value.includes(event)) {
      onChange(value.filter((e) => e !== event));
    } else {
      onChange([...value, event]);
    }
  };

  const toggleCategory = (events: WebhookEventType[]) => {
    const allSelected = events.every((e) => value.includes(e));
    if (allSelected) {
      onChange(value.filter((e) => !events.includes(e)));
    } else {
      const newEvents = [...value];
      events.forEach((e) => {
        if (!newEvents.includes(e)) {
          newEvents.push(e);
        }
      });
      onChange(newEvents);
    }
  };

  return (
    <div className="space-y-4">
      {EVENT_CATEGORIES.map((category) => {
        const categoryEvents = category.events.map((e) => e.type);
        const allSelected = categoryEvents.every((e) => value.includes(e));
        const someSelected =
          !allSelected && categoryEvents.some((e) => value.includes(e));

        return (
          <div key={category.name} className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`category-${category.name}`}
                checked={allSelected}
                onCheckedChange={() => toggleCategory(categoryEvents)}
                className={someSelected ? "data-[state=checked]:bg-primary/50" : ""}
              />
              <Label
                htmlFor={`category-${category.name}`}
                className="text-sm font-medium cursor-pointer"
              >
                {category.name}
              </Label>
            </div>
            <div className="ml-6 space-y-1">
              {category.events.map((event) => (
                <div key={event.type} className="flex items-start gap-2">
                  <Checkbox
                    id={event.type}
                    checked={value.includes(event.type)}
                    onCheckedChange={() => toggleEvent(event.type)}
                  />
                  <div className="grid gap-0.5 leading-none">
                    <Label
                      htmlFor={event.type}
                      className="text-sm cursor-pointer"
                    >
                      {event.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {event.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
