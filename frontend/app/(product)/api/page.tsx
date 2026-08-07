"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Check,
  AlertTriangle,
  Terminal,
  ChevronDown,
} from "lucide-react";
import { ApiKey, useApiKeys } from "@/hooks/use-api-keys";
import { useSources } from "@/hooks/use-sources";
import { CodeBlock } from "@/components/connect/code-block";
import { HardwareTabs } from "@/components/connect/hardware-tabs";
import { AGENT_SETUP_PROMPT } from "@/lib/agent-setup";
import {
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export default function ApiKeysPage() {
  const { keys, createKey, revokeKey } = useApiKeys();
  const { refresh: refreshSources } = useSources();
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [dataArrived, setDataArrived] = useState(false);
  const [arrivedSlug, setArrivedSlug] = useState<string | null>(null);

  // Poll for first data after key creation
  useEffect(() => {
    if (!newKeySecret || dataArrived) return;
    const interval = setInterval(async () => {
      try {
        const freshSources = await refreshSources();
        if (freshSources.length > 0) {
          // The most recently seen/created source is the one that just
          // came online — link its slug into the dashboard quick-start.
          const latest = [...freshSources].sort(
            (a, b) =>
              new Date(b.last_seen_at ?? b.created_at).getTime() -
              new Date(a.last_seen_at ?? a.created_at).getTime(),
          )[0];
          setArrivedSlug(latest.slug);
          setDataArrived(true);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [newKeySecret, dataArrived, refreshSources]);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setIsCreatingKey(true);
    setKeyError(null);
    try {
      const result = await createKey(newKeyName.trim());
      setNewKeySecret(result.key.secret);
      setNewKeyName("");
    } catch (error: unknown) {
      setKeyError(
        error instanceof Error ? error.message : "Failed to create key",
      );
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleRevokeKey = async () => {
    if (!keyToRevoke) return;
    setIsRevoking(true);
    try {
      await revokeKey(keyToRevoke);
      setKeyToRevoke(null);
    } catch (error: unknown) {
      setKeyError(
        error instanceof Error ? error.message : "Failed to revoke key",
      );
      setKeyToRevoke(null);
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <PageWrapper
      title="API Keys"
      description="Manage API keys for your devices and integrations"
    >
      <div className="flex-1 overflow-auto">
        <div className="p-6 max-w-2xl mx-auto space-y-8">
          <div className="space-y-4">
            <SectionHeader>Create API Key</SectionHeader>

            <Card className="p-4">
              {newKeySecret ? (
                <div className="space-y-5">
                  <div className="bg-green-500/10 border border-green-500/20 rounded-md p-3">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">
                        API Key Created (save this!)
                      </p>
                    </div>
                  </div>

                  <CodeBlock code={newKeySecret} language="text" />

                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Run this on your Raspberry Pi, Jetson, or any Linux
                      device.
                    </p>
                    <CodeBlock
                      code={`curl -sL https://app.plexus.company/setup | bash -s -- --key ${newKeySecret}`}
                      language="bash"
                    />
                    <p className="text-xs text-muted-foreground">
                      Handles everything — Python, dependencies, auto-start.
                    </p>
                  </div>

                  {dataArrived && (
                    <div className="bg-green-500/10 border border-green-500/20 rounded-md px-3 py-2 flex items-center gap-2">
                      <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Data is arriving —{" "}
                        <Link
                          href={
                            arrivedSlug
                              ? `/dashboards?quick=${encodeURIComponent(arrivedSlug)}`
                              : "/dashboards"
                          }
                          className="underline underline-offset-2 hover:no-underline"
                        >
                          create a dashboard →
                        </Link>
                      </p>
                    </div>
                  )}

                  <details className="group">
                    <summary className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                      Custom integration? (Arduino, ROS, Python SDK, HTTP)
                    </summary>
                    <div className="mt-3 ml-4.5">
                      <HardwareTabs
                        apiKey={newKeySecret}
                        sourceId="my-device"
                      />
                    </div>
                  </details>

                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7"
                    onClick={() => {
                      setNewKeySecret(null);
                      setDataArrived(false);
                      setArrivedSlug(null);
                    }}
                  >
                    Done
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {keyError && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                      <p className="text-xs text-destructive flex-1">
                        {keyError}
                      </p>
                      <Button
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setKeyError(null)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="Key name (e.g., Lab Sensors)"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      className="h-9 text-sm flex-1"
                      onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
                    />
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      onClick={handleCreateKey}
                      disabled={isCreatingKey || !newKeyName.trim()}
                    >
                      {isCreatingKey ? "Creating..." : "Create API Key"}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <SectionHeader>Set Up With Your Coding Agent</SectionHeader>
            <p className="text-sm text-muted-foreground -mt-2">
              Paste this into Claude Code, Cursor, or any coding agent open in
              your app&apos;s repo. It instruments your code and requests an
              API key you approve here — no manual key handling.
            </p>
            <Card className="p-4">
              <CodeBlock code={AGENT_SETUP_PROMPT} language="text" />
            </Card>
          </div>

          {keys.length > 0 && (
            <div className="space-y-4">
              <SectionHeader>
                Active Keys ({keys.filter((k) => k.active).length})
              </SectionHeader>
              <Card className="p-4">
                <div className="space-y-2">
                  {keys
                    .filter((k) => k.active)
                    .map((key: ApiKey) => (
                      <div
                        key={key.id}
                        className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md"
                      >
                        <div className="flex items-center gap-3">
                          <div>
                            <span className="text-sm font-medium">
                              {key.name}
                            </span>
                            <span className="text-muted-foreground font-mono text-xs ml-2">
                              {key.keyPrefix}...
                            </span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950"
                          onClick={() => setKeyToRevoke(key.id)}
                        >
                          Revoke
                        </Button>
                      </div>
                    ))}
                </div>
              </Card>
            </div>
          )}

          <div className="space-y-4">
            <SectionHeader>Fleet Provisioning</SectionHeader>
            <p className="text-sm text-muted-foreground -mt-2">
              Deploy Plexus to many devices using a single API key. No
              per-device pairing needed.
            </p>

            <Card className="p-4 space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">Run this on each device</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Or bake it into your provisioning image. Installs Python if
                  needed, sets up the agent, and auto-starts it.
                </p>
                <CodeBlock
                  code={`curl -sL https://app.plexus.company/setup | bash -s -- --key ${
                    keys.filter((k) => k.active).length > 0
                      ? keys
                          .filter((k) => k.active)
                          .sort(
                            (a, b) =>
                              new Date(b.createdAt).getTime() -
                              new Date(a.createdAt).getTime(),
                          )[0].keyPrefix + "..."
                      : "YOUR_API_KEY"
                  }`}
                  language="bash"
                />
                {keys.filter((k) => k.active).length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Replace{" "}
                    <code className="bg-muted px-1 py-0.5 rounded text-[11px]">
                      {
                        keys
                          .filter((k) => k.active)
                          .sort(
                            (a, b) =>
                              new Date(b.createdAt).getTime() -
                              new Date(a.createdAt).getTime(),
                          )[0].keyPrefix
                      }
                      ...
                    </code>{" "}
                    with your full API key. Each device auto-registers and
                    appears in your fleet.
                  </p>
                )}
                {keys.filter((k) => k.active).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Create an API key above first, then paste the full key into
                    this command.
                  </p>
                )}
              </div>

              <details className="group border-t pt-4">
                <summary className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
                  Other methods (Python SDK, HTTP API)
                </summary>
                <div className="mt-4 space-y-5">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Python SDK</p>
                    <p className="text-xs text-muted-foreground">
                      For custom integrations or existing Python applications:
                    </p>
                    <div className="bg-zinc-950 rounded-md p-2.5 overflow-x-auto">
                      <CodeBlock code={`pipx install plexus-python`} />
                    </div>
                    <div className="bg-zinc-950 rounded-md p-2.5 overflow-x-auto">
                      <CodeBlock
                        code={`from plexus import Plexus\n\npx = Plexus(api_key="${
                          keys.filter((k) => k.active).length > 0
                            ? keys.filter((k) => k.active)[0].keyPrefix + "..."
                            : "YOUR_API_KEY"
                        }", source_id="my-device")\npx.send("temperature", 72.5)`}
                        language="python"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">HTTP API</p>
                    <p className="text-xs text-muted-foreground">
                      For embedded devices or custom firmware, POST telemetry
                      directly:
                    </p>
                    <div className="bg-zinc-950 rounded-md p-2.5 overflow-x-auto">
                      <CodeBlock
                        code={`curl -X POST https://gateway.plexus.company/ingest \\\n  -H "x-api-key: ${
                          keys.filter((k) => k.active).length > 0
                            ? keys.filter((k) => k.active)[0].keyPrefix + "..."
                            : "YOUR_API_KEY"
                        }" \\\n  -H "Content-Type: application/json" \\\n  -d '{"source_id":"device-001","points":[{"metric":"temp","value":72.5}]}'`}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Set a unique{" "}
                      <code className="bg-muted px-1 py-0.5 rounded text-[11px]">
                        source_id
                      </code>{" "}
                      per device to identify it in your fleet.
                    </p>
                  </div>
                </div>
              </details>
            </Card>
          </div>
        </div>
      </div>

      <AlertDialog
        open={!!keyToRevoke}
        onOpenChange={(open) => !open && setKeyToRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke this API key? This action cannot
              be undone and any devices using this key will no longer be able to
              authenticate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRevokeKey}
              disabled={isRevoking}
            >
              {isRevoking ? (
                <>
                  <Spinner variant="button" className="h-3.5 w-3.5 mr-1.5" />
                  Revoking...
                </>
              ) : (
                "Revoke"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageWrapper>
  );
}
