"use client";

/**
 * First-run surface for an org with zero sources. One vertical flow:
 * what Plexus is → get data flowing (tailored by what you're observing)
 * → the paths that open up once data lands. Replaced by the fleet status
 * view permanently after the first source exists.
 */

import { useState } from "react";
import Link from "next/link";
import {
  Server,
  Cpu,
  Database,
  LayoutDashboard,
  Bell,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { CodeBlock } from "@/components/connect/code-block";
import { HardwareTabs } from "@/components/connect/hardware-tabs";
import { AGENT_SETUP_LEAD, AGENT_SETUP_PROMPT } from "@/lib/agent-setup";
import { SOURCE_KINDS, type SourceKindCategory } from "@/lib/sources/kinds";
import { getTemplate } from "@/lib/dashboards/templates";

type ObservingChoice = SourceKindCategory | "database";

const CHOICES: {
  id: ObservingChoice;
  icon: LucideIcon;
  label: string;
  sublabel: string;
}[] = [
  {
    id: "software",
    icon: Server,
    label: "Software service",
    sublabel: "An API, web app, or worker",
  },
  {
    id: "hardware",
    icon: Cpu,
    label: "Hardware fleet",
    sublabel: "Boards, Linux devices, robots, satellites",
  },
  {
    id: "database",
    icon: Database,
    label: "Existing database",
    sublabel: "Prometheus, ClickHouse, Influx, Postgres",
  },
];

/** "Service health and Web analytics" — derived from the kind registry. */
function templateNamesFor(category: SourceKindCategory): string {
  const names = [
    ...new Set(
      SOURCE_KINDS.filter((k) => k.category === category)
        .map((k) => k.defaultTemplate && getTemplate(k.defaultTemplate)?.name)
        .filter((n): n is string => !!n),
    ),
  ];
  return names.join(" and ");
}

function dashboardsSubtitle(choice: ObservingChoice): string {
  if (choice === "database") return "Prebuilt layouts for your connected metrics";
  return `${templateNamesFor(choice)}, prebuilt`;
}

export function GetStartedPanel() {
  const [choice, setChoice] = useState<ObservingChoice>("software");

  const paths = [
    {
      href: "/dashboards",
      icon: LayoutDashboard,
      title: "Dashboards from templates",
      subtitle: dashboardsSubtitle(choice),
    },
    {
      href: "/alerts/monitors",
      icon: Bell,
      title: "Alerts",
      subtitle: "Watch a metric and get notified when it crosses a line.",
    },
    {
      href: "/terminal",
      icon: Terminal,
      title: "Ask questions of your data",
      subtitle: "Query telemetry in plain language.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Get your first data in</h2>
        <p className="text-xs text-muted-foreground">
          Plexus ingests metrics and events from devices and services. Once
          data lands, dashboards, alerts, and queries build on top of it.
        </p>
      </div>

      <div className="space-y-2">
        <SectionHeader>Get data flowing</SectionHeader>
        <p className="text-xs text-muted-foreground">What are you observing?</p>
        <div className="flex flex-col sm:flex-row gap-1.5">
          {CHOICES.map(({ id, icon: Icon, label, sublabel }) => (
            <button
              key={id}
              type="button"
              onClick={() => setChoice(id)}
              className={
                "flex-1 flex items-start gap-2.5 rounded border px-3 py-2 transition-colors text-left " +
                (choice === id
                  ? "border-border bg-foreground/10 text-foreground"
                  : "border-border/50 hover:bg-muted/60 text-muted-foreground hover:text-foreground")
              }
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[11px] font-medium">{label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {sublabel}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
          {choice === "software" && (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {AGENT_SETUP_LEAD}
              </p>
              <CodeBlock code={AGENT_SETUP_PROMPT} language="text" />
            </>
          )}
          {choice === "hardware" && (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Pick your platform below, drop the snippet into your device
                code, and readings appear under your source id. The coding-agent
                prompt on the software path works for firmware repos too.
              </p>
              <HardwareTabs apiKey="" sourceId="" />
              <Link
                href="/api"
                className="inline-block text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Create an API key
              </Link>
            </>
          )}
          {choice === "database" && (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Pull metrics from a database you already run — Prometheus,
                ClickHouse, InfluxDB, TimescaleDB, or Postgres. Plexus reads
                only; nothing is written or moved.
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/connections">Add a connection</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <SectionHeader>Then pick a path</SectionHeader>
        <div className="rounded-lg border divide-y">
          {paths.map(({ href, icon: Icon, title, subtitle }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors"
            >
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-sm">{title}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {subtitle}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
