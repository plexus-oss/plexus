"use client";

import Link from "next/link";
import {
  LayoutDashboard,
  Bell,
  Terminal,
  Plug,
  type LucideIcon,
} from "lucide-react";

interface Shortcut {
  href: string;
  icon: LucideIcon;
  label: string;
  sublabel: string;
}

const SHORTCUTS: Shortcut[] = [
  {
    href: "/dashboards",
    icon: LayoutDashboard,
    label: "New dashboard",
    sublabel: "From a template",
  },
  {
    href: "/alerts/monitors",
    icon: Bell,
    label: "New monitor",
    sublabel: "Alert on a metric",
  },
  {
    href: "/terminal",
    icon: Terminal,
    label: "Ask Terminal",
    sublabel: "Query in plain language",
  },
  {
    href: "/connections",
    icon: Plug,
    label: "Add source",
    sublabel: "Instrument or connect",
  },
];

/** Compact navigation strip: the four paths out of the home page. */
export function PathShortcuts() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border divide-x divide-y sm:divide-y-0">
      {SHORTCUTS.map(({ href, icon: Icon, label, sublabel }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors"
        >
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-medium">{label}</div>
            <div className="text-[10px] text-muted-foreground truncate">
              {sublabel}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
