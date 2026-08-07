import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KeyboardShortcut } from "@/components/ui/keyboard-shortcut";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  shortcut?: string;
}

interface EmptyStateProps {
  /** Optional icon to display */
  icon?: LucideIcon;
  /** Main heading text */
  title: string;
  /** Optional description text */
  description?: string;
  /** Optional action button with keyboard shortcut */
  action?: EmptyStateAction;
  /** Style variant */
  variant?: "default" | "compact" | "card";
  /** Additional classes */
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "default",
  className,
}: EmptyStateProps) {
  if (variant === "compact") {
    return (
      <div
        className={cn(
          "text-center py-4 text-muted-foreground text-sm",
          className
        )}
      >
        {title}
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center p-6 text-center",
          className
        )}
      >
        {Icon && (
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-3">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <p className="text-sm text-muted-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground/70 mt-1">{description}</p>
        )}
        {action && (
          <Button
            variant="outline"
            size="sm"
            onClick={action.onClick}
            className="mt-3 gap-2"
          >
            {action.label}
            {action.shortcut && (
              <KeyboardShortcut
                shortcut={action.shortcut}
                className="opacity-60"
              />
            )}
          </Button>
        )}
      </div>
    );
  }

  // Default variant - full featured with icon background
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-12 px-4",
        className
      )}
    >
      {Icon && (
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
          <Icon className="h-6 w-6 text-primary" />
        </div>
      )}
      <h2 className="text-lg font-medium text-foreground">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          {description}
        </p>
      )}
      {action && (
        <Button onClick={action.onClick} className="mt-4 gap-2">
          {action.label}
          {action.shortcut && (
            <KeyboardShortcut
              shortcut={action.shortcut}
              className="opacity-60"
            />
          )}
        </Button>
      )}
    </div>
  );
}
