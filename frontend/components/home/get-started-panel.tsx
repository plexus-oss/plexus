"use client";

/**
 * First-run surface for an org with zero sources.
 *
 * One job: get the first reading in. Plexus is the front end for hardware
 * fleets, so the hardware path is THE path — the other two are a quiet
 * switch, not a decision the user has to make before anything happens.
 *
 * The panel polls while the org is empty, so the first reading landing swaps
 * the whole screen to the fleet view on its own. Nobody should have to
 * reload to find out whether it worked.
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import { Cpu, Server, Database, KeyRound, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/connect/code-block";
import { HardwareTabs } from "@/components/connect/hardware-tabs";
import { AGENT_SETUP_LEAD, AGENT_SETUP_PROMPT } from "@/lib/agent-setup";
import { useSources } from "@/hooks/use-sources";

type Path = "hardware" | "software" | "database";

const ALTERNATES: { id: Exclude<Path, "hardware">; icon: LucideIcon; label: string }[] = [
  { id: "software", icon: Server, label: "a software service" },
  { id: "database", icon: Database, label: "a database I already run" },
];

export function GetStartedPanel() {
  const [path, setPath] = useState<Path>("hardware");
  const [apiKey, setApiKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Mint a real key inline so the snippet above is runnable as-is — the
  // placeholder-plus-go-to-another-page version couldn't be copy-pasted.
  const generateKey = useCallback(async () => {
    setGenerating(true);
    setKeyError(null);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "first-device", scopes: ["write"] }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        key?: { secret?: string };
        error?: string;
      };
      if (!res.ok || !body.key?.secret) {
        setKeyError(body.error || "Couldn't create a key — try the API Keys page.");
        return;
      }
      setApiKey(body.key.secret);
    } catch {
      setKeyError("Couldn't create a key — try the API Keys page.");
    } finally {
      setGenerating(false);
    }
  }, []);

  // Poll while empty. HomePage reads the same SWR key, so the moment a source
  // exists this screen is replaced by the fleet view without a reload.
  useSources({ refreshInterval: 5000 });

  return (
    <div className="max-w-2xl space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-sm font-medium">Get your first reading in</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Everything else builds on this. The moment your first reading lands,
          we build your starter dashboard and open it.
        </p>
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
        {path === "hardware" && (
          <>
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">
                Boards, Linux devices, robots, satellites
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Drop this into your device code. Readings appear under your
              source id.
            </p>
            <HardwareTabs apiKey={apiKey} sourceId="" />
            {!apiKey ? (
              <div className="space-y-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={generateKey}
                  disabled={generating}
                >
                  <KeyRound className="h-3 w-3 mr-1.5" />
                  {generating
                    ? "Generating…"
                    : "Generate an API key for this snippet"}
                </Button>
                {keyError && (
                  <p className="text-[11px] text-muted-foreground">
                    {keyError}{" "}
                    <Link
                      href="/api"
                      className="underline underline-offset-2 hover:text-foreground transition-colors"
                    >
                      API Keys
                    </Link>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Your key is in the snippet above — it&apos;s shown this once,
                so copy the snippet now. Manage keys in{" "}
                <Link
                  href="/api"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  API Keys
                </Link>
                .
              </p>
            )}
          </>
        )}

        {path === "software" && (
          <>
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">
                An API, web app, or worker
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {AGENT_SETUP_LEAD}
            </p>
            <CodeBlock code={AGENT_SETUP_PROMPT} language="text" />
          </>
        )}

        {path === "database" && (
          <>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-medium">
                Prometheus, ClickHouse, InfluxDB, TimescaleDB, Postgres
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Plexus reads your database in place. Nothing is written, nothing
              is moved.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/connections">Add a connection</Link>
            </Button>
          </>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {path === "hardware" ? (
          <>
            Connecting something else?{" "}
            {ALTERNATES.map(({ id, label }, i) => (
              <span key={id}>
                {i > 0 && " or "}
                <button
                  type="button"
                  onClick={() => setPath(id)}
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  {label}
                </button>
              </span>
            ))}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setPath("hardware")}
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            Back to connecting a hardware fleet
          </button>
        )}
      </p>

      <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-muted-foreground/60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        </span>
        Watching for your first reading
      </p>
    </div>
  );
}
