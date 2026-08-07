"use client";

import { useMemo } from "react";
import { Send, Mail, Webhook, type LucideIcon } from "lucide-react";
import { useSlackIntegrations } from "@/hooks/use-slack-integrations";
import { useEmailIntegrations } from "@/hooks/use-email-integrations";
import { useWebhooks } from "@/hooks/use-webhooks";
import { cn } from "@/lib/utils";

export interface NotificationTargetOption {
  id: string;
  label: string;
  icon: LucideIcon;
}

/**
 * All integrations a monitor can target, in stable chip order
 * (Slack channels, then emails, then webhooks).
 */
export function useNotificationTargetOptions(): NotificationTargetOption[] {
  const { integrations: slack } = useSlackIntegrations();
  const { integrations: email } = useEmailIntegrations();
  const { webhooks } = useWebhooks();

  return useMemo(
    () => [
      ...slack.map((i) => ({
        id: i.id,
        label: `#${i.channel_name}`,
        icon: Send,
      })),
      ...email.map((i) => ({ id: i.id, label: i.email_address, icon: Mail })),
      ...webhooks.map((w) => ({ id: w.id, label: w.name, icon: Webhook })),
    ],
    [slack, email, webhooks],
  );
}

/**
 * Chip row for picking a monitor's notification targets. Selection semantics
 * live with the caller: an empty selection means default fan-out.
 */
export function NotificationTargetChips({
  options,
  selected,
  onToggle,
  disabled,
}: {
  options: NotificationTargetOption[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((target) => {
        const isSelected = selected.includes(target.id);
        const Icon = target.icon;
        return (
          <button
            key={target.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(target.id)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-all",
              isSelected
                ? "border-blue-500/50 bg-blue-500/5 ring-1 ring-blue-500/20"
                : "border-dashed text-muted-foreground hover:border-border hover:bg-accent/50",
              disabled && "opacity-60 pointer-events-none",
            )}
          >
            <Icon className="h-3 w-3" />
            {target.label}
          </button>
        );
      })}
    </div>
  );
}
