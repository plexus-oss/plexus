import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingsSection({
  icon,
  title,
  description,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      <div className="pl-10 border-l border-border/50 ml-[13px]">
        {children}
      </div>
    </div>
  );
}
