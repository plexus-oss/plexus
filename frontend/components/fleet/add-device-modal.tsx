"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Key,
  Plus,
  Check,
  ChevronLeft,
  Globe,
  Cpu,
  Terminal,
  Code2,
  Plug,
  CircleDot,
  Server,
  AppWindow,
  Timer,
} from "lucide-react";
import { usePlexusSession } from "@/hooks/use-plexus-session";
import { useApiKeys, type ApiKey } from "@/hooks/use-api-keys";
import { useSources } from "@/hooks/use-sources";
import {
  ResourcePalette,
  Kbd,
  type PaletteOption,
  type PaletteSection,
} from "@/components/data/resource-palette";
import type { Source } from "@/lib/db/types";
import { CodeBlock } from "@/components/connect/code-block";
import { lookupTle } from "@/lib/tle/lookup";
import type { TleLookupResult } from "@/lib/types/tle";
import { RETENTION } from "@/lib/retention";

type View =
  | "palette"
  | "microcontroller"
  | "linux"
  | "python"
  | "http"
  | "service"
  | "web-app"
  | "worker"
  | "satellite"
  | "empty";

interface AddDeviceModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (source: Source) => void;
  presetName?: string;
  initialView?: Exclude<View, "palette">;
}

function generateShortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `dev-${id}`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || ""
  );
}

export function AddDeviceModal({
  open,
  onClose,
  onSuccess,
  presetName,
  initialView,
}: AddDeviceModalProps) {
  const [view, setView] = useState<View>(initialView ?? "palette");
  const [query, setQuery] = useState("");
  const [generatedId, setGeneratedId] = useState(() => generateShortId());
  const [isCreating, setIsCreating] = useState(false);

  // API key
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);
  const [isCreatingKey, setIsCreatingKey] = useState(false);

  // Satellite
  const [satLookupResult, setSatLookupResult] =
    useState<TleLookupResult | null>(null);
  const [isSatAdding, setIsSatAdding] = useState(false);
  const [satColor, setSatColor] = useState("#3b82f6");
  const [satGroupName, setSatGroupName] = useState("");
  const [satNameOverride, setSatNameOverride] = useState("");

  // Smart detection (NORAD)
  type Detection =
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "norad"; tle: TleLookupResult }
    | { kind: "none" };
  // Async TLE lookup result, tagged with the trimmed query it was fetched for
  // so we can tell whether it still matches the current input.
  const [tle, setTle] = useState<{
    q: string;
    result: TleLookupResult | null;
  }>({ q: "", result: null });

  usePlexusSession();
  const { keys, createKey } = useApiKeys();
  const { createSource, refresh: refreshSources } = useSources();

  // Seed the query from presetName when the modal opens, or when presetName
  // changes while open (adjust-state-during-render instead of an effect).
  const [presetSync, setPresetSync] = useState({ open, presetName });
  if (presetSync.open !== open || presetSync.presetName !== presetName) {
    setPresetSync({ open, presetName });
    if (open && presetName) setQuery(presetName);
  }

  // Apply initialView when the modal opens, or when initialView changes while
  // open (adjust-state-during-render instead of an effect).
  const [viewSync, setViewSync] = useState({ open, initialView });
  if (viewSync.open !== open || viewSync.initialView !== initialView) {
    setViewSync({ open, initialView });
    if (open && initialView) setView(initialView);
  }

  // Debounced NORAD lookup while on palette. The effect only performs the
  // async fetch (setState lives in the async callback); the synchronous
  // idle/none/checking states are derived from the query below.
  useEffect(() => {
    if (view !== "palette") return;
    const q = query.trim();
    if (!q || !/^\d{1,6}$/.test(q)) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const result = await lookupTle({ norad_id: parseInt(q, 10) });
        if (!cancelled) setTle({ q, result });
      } catch {
        if (!cancelled) setTle({ q, result: null });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, view]);

  // Detection state derived from the current query/view plus the latest TLE
  // lookup. While a numeric query has no matching result yet → "checking".
  const detection: Detection = useMemo(() => {
    if (view !== "palette") return { kind: "idle" };
    const q = query.trim();
    if (!q) return { kind: "idle" };
    if (!/^\d{1,6}$/.test(q)) return { kind: "none" };
    if (tle.q === q) {
      return tle.result
        ? { kind: "norad", tle: tle.result }
        : { kind: "none" };
    }
    return { kind: "checking" };
  }, [view, query, tle]);

  const selectedKey = selectedKeyId
    ? keys.find((k) => k.id === selectedKeyId)
    : null;
  const apiKeyForInstructions =
    newKeySecret ?? (selectedKey ? `${selectedKey.keyPrefix}...` : null);
  const slug = slugify(query) || generatedId;

  const reset = useCallback(() => {
    setView("palette");
    setQuery("");
    setGeneratedId(generateShortId());
    setIsCreating(false);
    setSelectedKeyId(null);
    setNewKeySecret(null);
    setIsCreatingKey(false);
    setSatLookupResult(null);
    setIsSatAdding(false);
    setSatColor("#3b82f6");
    setSatGroupName("");
    setSatNameOverride("");
    setTle({ q: "", result: null });
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleCreateKey = async () => {
    setIsCreatingKey(true);
    try {
      const result = await createKey(query || "Device Key");
      setNewKeySecret(result.key.secret);
      setSelectedKeyId(result.key.id);
    } catch {
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleCreateDevice = async (device_type?: string) => {
    setIsCreating(true);
    try {
      const fresh = await refreshSources();
      const existing = fresh.find((s: Source) => s.slug === slug);
      let result: Source;
      if (existing) {
        result = existing;
      } else {
        result = await createSource({
          source_type: "device",
          slug,
          name: query || undefined,
          device_type,
        });
      }
      onSuccess(result);
      handleClose();
    } catch {
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddSatellite = async () => {
    if (!satLookupResult) return;
    setIsSatAdding(true);
    try {
      const satName = satNameOverride || satLookupResult.name;
      const result = await createSource({
        source_type: "device",
        slug: `sat-${satLookupResult.norad_id}`,
        name: satName,
        device_type: "satellite",
        metadata: {
          norad_id: satLookupResult.norad_id,
          official_name: satLookupResult.name,
          color: satColor,
          group_name: satGroupName || null,
          tle_line1: satLookupResult.tle_line1,
          tle_line2: satLookupResult.tle_line2,
          tle_epoch: satLookupResult.tle_epoch,
          tle_fetched_at: new Date().toISOString(),
        },
      });
      onSuccess(result);
      handleClose();
    } catch {
    } finally {
      setIsSatAdding(false);
    }
  };

  const pickSatellite = (tle: TleLookupResult) => {
    setSatLookupResult(tle);
    setView("satellite");
  };

  // ─── Palette options ───────────────────────────────────────────────────────

  const options: PaletteOption[] = useMemo(() => {
    const all: PaletteOption[] = [];

    if (detection.kind === "norad") {
      all.push({
        id: "suggested-sat",
        icon: <Globe />,
        title: detection.tle.name,
        subtitle: `Satellite · NORAD ${detection.tle.norad_id}`,
        sectionId: "suggested",
        onSelect: () => pickSatellite(detection.tle),
        keywords: ["satellite", "norad", detection.tle.name.toLowerCase()],
        accent: true,
      });
    }

    all.push(
      {
        id: "microcontroller",
        icon: <Cpu />,
        title: "Microcontroller",
        subtitle: "ESP32, Arduino, or any HTTP-capable board",
        sectionId: "hardware",
        onSelect: () => setView("microcontroller"),
        keywords: ["esp32", "microcontroller", "arduino", "firmware", "c"],
      },
      {
        id: "linux",
        icon: <Terminal />,
        title: "Raspberry Pi / Linux",
        subtitle: "Install our agent with one curl command",
        sectionId: "hardware",
        onSelect: () => setView("linux"),
        keywords: ["linux", "pi", "raspberry", "agent", "debian", "ubuntu"],
      },
      {
        id: "python",
        icon: <Code2 />,
        title: "Python script",
        subtitle: "Post telemetry from a script or backend job",
        sectionId: "hardware",
        onSelect: () => setView("python"),
        keywords: ["python", "script", "backend", "requests"],
      },
      {
        id: "http",
        icon: <Plug />,
        title: "HTTP device (generic)",
        subtitle: "Use any language — just POST JSON to our endpoint",
        sectionId: "hardware",
        onSelect: () => setView("http"),
        keywords: ["http", "curl", "rest", "api", "generic", "custom"],
      },
      {
        id: "service",
        icon: <Server />,
        title: "Service / API",
        subtitle: "Latency, errors, and throughput from a backend",
        sectionId: "software",
        onSelect: () => setView("service"),
        keywords: ["service", "api", "backend", "server", "node", "software"],
      },
      {
        id: "web-app",
        icon: <AppWindow />,
        title: "Web app",
        subtitle: "Product events from a site, via your own server route",
        sectionId: "software",
        onSelect: () => setView("web-app"),
        keywords: ["web", "frontend", "site", "analytics", "events", "software"],
      },
      {
        id: "worker",
        icon: <Timer />,
        title: "Worker / cron",
        subtitle: "Job runs, durations, and heartbeats",
        sectionId: "software",
        onSelect: () => setView("worker"),
        keywords: ["worker", "cron", "job", "queue", "heartbeat", "software"],
      },
      {
        id: "satellite",
        icon: <Globe />,
        title: "Satellite",
        subtitle: "Look up by NORAD ID or name and track orbit data",
        sectionId: "data",
        onSelect: () => setView("satellite"),
        keywords: ["satellite", "norad", "orbit", "space", "tle"],
      },
      {
        id: "empty",
        icon: <CircleDot />,
        title: "Empty device",
        subtitle:
          "Pick a name or UUID now — useful as a filter value for linked data later",
        sectionId: "other",
        onSelect: () => setView("empty"),
        keywords: ["empty", "blank", "skip", "manual", "uuid"],
      },
    );

    return all;
  }, [detection]);

  const paletteSections: PaletteSection[] = [
    { id: "suggested", label: "Suggested" },
    { id: "demos", label: "Demos" },
    { id: "hardware", label: "Hardware" },
    { id: "software", label: "Software" },
    { id: "data", label: "Data sources" },
    { id: "other", label: "Other" },
  ];

  // ─── Render ────────────────────────────────────────────────────────────────

  const titleText = (() => {
    switch (view) {
      case "microcontroller":
        return "Microcontroller";
      case "linux":
        return "Raspberry Pi / Linux";
      case "python":
        return "Python script";
      case "http":
        return "HTTP device";
      case "service":
        return "Service / API";
      case "web-app":
        return "Web app";
      case "worker":
        return "Worker / cron";
      case "satellite":
        return "Add satellite";
      case "empty":
        return "Empty device";
      default:
        return "Add a device";
    }
  })();

  const isPalette = view === "palette";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl p-0 gap-0 border-border/60">
        {isPalette ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{titleText}</DialogTitle>
            </DialogHeader>
            <DevicePaletteContainer
              query={query}
              setQuery={setQuery}
              options={options}
              sections={paletteSections}
              loading={detection.kind === "checking"}
            />
          </>
        ) : (
          <div className="flex flex-col max-h-[90vh] min-h-0 w-full min-w-0">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/60 shrink-0 min-w-0">
              <button
                onClick={() => {
                  setQuery("");
                  setView("palette");
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <div className="h-3 w-px bg-border/60" />
              <DialogHeader className="flex-1 space-y-0 min-w-0">
                <DialogTitle className="text-sm font-medium truncate">
                  {titleText}
                </DialogTitle>
              </DialogHeader>
            </div>
            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-6 py-5 space-y-4">
              {(view === "microcontroller" ||
                view === "linux" ||
                view === "python" ||
                view === "http" ||
                view === "service" ||
                view === "web-app" ||
                view === "worker") && (
                <HardwareFlow
                  view={view}
                  slug={slug}
                  name={query}
                  setName={setQuery}
                  keys={keys}
                  selectedKeyId={selectedKeyId}
                  setSelectedKeyId={setSelectedKeyId}
                  newKeySecret={newKeySecret}
                  clearNewKey={() => {
                    setNewKeySecret(null);
                    setSelectedKeyId(null);
                  }}
                  isCreatingKey={isCreatingKey}
                  onCreateKey={handleCreateKey}
                  apiKeyForInstructions={apiKeyForInstructions}
                  isCreating={isCreating}
                  onDone={() =>
                    handleCreateDevice(
                      view === "linux"
                        ? "linux"
                        : view === "python"
                          ? "script"
                          : view === "microcontroller"
                            ? "embedded"
                            : view === "http"
                              ? "http"
                              : view, // service | web-app | worker map 1:1
                    )
                  }
                />
              )}

              {view === "empty" && (
                <EmptyFlow
                  name={query}
                  setName={setQuery}
                  slug={slug}
                  isCreating={isCreating}
                  onCreate={() => handleCreateDevice()}
                />
              )}

              {view === "satellite" && (
                <SatelliteFlow
                  initial={satLookupResult}
                  initialQuery={query}
                  result={satLookupResult}
                  setResult={setSatLookupResult}
                  color={satColor}
                  setColor={setSatColor}
                  groupName={satGroupName}
                  setGroupName={setSatGroupName}
                  nameOverride={satNameOverride}
                  setNameOverride={setSatNameOverride}
                  isAdding={isSatAdding}
                  onAdd={handleAddSatellite}
                />
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══ Device palette wrapper ══════════════════════════════════════════════════

function DevicePaletteContainer({
  query,
  setQuery,
  options,
  sections,
  loading,
}: {
  query: string;
  setQuery: (v: string) => void;
  options: PaletteOption[];
  sections: PaletteSection[];
  loading: boolean;
}) {
  const rate = "1k req/s";
  const retentionYears = Math.round(RETENTION.rawTelemetryDays / 365);
  return (
    <ResourcePalette
      query={query}
      setQuery={setQuery}
      options={options}
      sections={sections}
      placeholder="What are you adding? name, ID, or NORAD ID..."
      loading={loading}
      footerLeft={
        <>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> select
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> close
          </span>
        </>
      }
      footerRight={
        <div className="flex items-center gap-2 font-mono text-[10.5px]">
          <span>{rate}</span>
          <span className="text-border">·</span>
          <span>{retentionYears}y stored</span>
          <span className="text-border">·</span>
          <span>UTC</span>
        </div>
      }
    />
  );
}

// ═══ Hardware/software flow (snippet-driven creation) ════════════════════════

function HardwareFlow(props: {
  view:
    | "microcontroller"
    | "linux"
    | "python"
    | "http"
    | "service"
    | "web-app"
    | "worker";
  slug: string;
  name: string;
  setName: (v: string) => void;
  keys: ApiKey[];
  selectedKeyId: string | null;
  setSelectedKeyId: (v: string | null) => void;
  newKeySecret: string | null;
  clearNewKey: () => void;
  isCreatingKey: boolean;
  onCreateKey: () => void;
  apiKeyForInstructions: string | null;
  isCreating: boolean;
  onDone: () => void;
}) {
  const {
    view,
    slug,
    name,
    setName,
    keys,
    selectedKeyId,
    setSelectedKeyId,
    newKeySecret,
    clearNewKey,
    isCreatingKey,
    onCreateKey,
    apiKeyForInstructions,
    isCreating,
    onDone,
  } = props;

  const keyStr = apiKeyForInstructions ?? "<YOUR_API_KEY>";
  const host =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://app.plexus.company";

  const snippet = (() => {
    if (view === "microcontroller") {
      return {
        lang: "cpp",
        code: `#include <WiFi.h>
#include <time.h>
#include "plexus.hpp"

PlexusClient plexus("${keyStr}", "${slug}");

void setup() {
  Serial.begin(115200);
  WiFi.begin("YourSSID", "YourPassword");
  while (WiFi.status() != WL_CONNECTED) delay(500);
  configTime(0, 0, "pool.ntp.org"); // NTP required for timestamps
}

void loop() {
  plexus.send("temperature", 23.5);
  plexus.tick();          // flushes queued points
  delay(1000);
}`,
        copy: "C/C++ SDK for ESP32, ESP8266, and Arduino boards with WiFi. NTP sync is required so points get accurate timestamps.",
      };
    }
    if (view === "linux") {
      return {
        lang: "bash",
        code: `curl -sL ${host}/setup | bash -s -- --key ${keyStr} --slug ${slug}`,
        copy: "Managed install: creates a venv, pins plexus-python, writes ~/.plexus/config.json, and registers a systemd service so it auto-restarts. Use the Python path instead if you want to call the SDK from your own code.",
      };
    }
    if (view === "python") {
      return {
        lang: "python",
        code: `from plexus import Plexus

px = Plexus(api_key="${keyStr}", source_id="${slug}")
px.send("temperature", 23.5)`,
        copy: "The Plexus Python SDK. Reads PLEXUS_API_KEY from env if you omit api_key. Call px.send() as often as you like — the client batches and flushes automatically.",
      };
    }
    if (view === "service") {
      return {
        lang: "typescript",
        code: `// npm install plexus-typescript   (server-side — key stays in env)
import { Plexus } from "plexus-typescript";

const px = new Plexus({ sourceId: "${slug}", kind: "service" });
await px.send("request_latency_ms", 42, { tags: { route: "/checkout" } });
await px.send("error_count", 0);`,
        copy: "The Plexus TypeScript SDK: reads PLEXUS_API_KEY from env, retries with backoff, buffers on failure, and declares this source as a service so it gets the right dashboard template.",
      };
    }
    if (view === "web-app") {
      return {
        lang: "typescript",
        code: `// npm install plexus-typescript
// app/api/plexus/route.ts — your server route holds the key
import { createIngestProxy } from "plexus-typescript/server";
export const POST = createIngestProxy({
  sourceId: "${slug}",
  allowMetrics: ["page_view", "signup", "read_seconds"],
});

// browser — fire-and-forget beacons, works on page unload
import { createBrowserClient } from "plexus-typescript/browser";
const plexus = createBrowserClient();
plexus.track("signup", 1, { page: "/pricing" });`,
        copy: "Browsers never hold the API key: the SDK's server proxy forwards allowlisted events to Plexus, and the browser client beacons to it.",
      };
    }
    if (view === "worker") {
      return {
        lang: "typescript",
        code: `// npm install plexus-typescript — end of each job run
import { Plexus } from "plexus-typescript";

const px = new Plexus({ sourceId: "${slug}", kind: "worker" });
await px.sendBatch([
  ["job_duration_ms", 5210],
  ["heartbeat", 1],
]);
await px.close();`,
        copy: "Report a duration and a heartbeat at the end of each run (any language works — this is the TS SDK; curl works too). Pair with an offline monitor to get alerted when the job stops reporting.",
      };
    }
    return {
      lang: "bash",
      code: `curl -X POST https://gateway.plexus.company/ingest \\
  -H "x-api-key: ${keyStr}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source_id": "${slug}",
    "points": [
      {"metric": "temperature", "value": 23.5}
    ]
  }'`,
      copy: "Works from any language — POST JSON with the x-api-key header. source_id is your device slug; metric names are free-form.",
    };
  })();

  return (
    <div className="space-y-5 min-w-0">
      <div className="space-y-2 min-w-0">
        <Label className="text-xs text-muted-foreground">
          {view === "service" || view === "web-app" || view === "worker"
            ? "Source name"
            : "Device name"}
        </Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            view === "service" || view === "web-app" || view === "worker"
              ? "e.g. checkout-api, web-frontend"
              : "e.g. weather-station, drone-001"
          }
        />
        <p className="text-xs text-muted-foreground">
          ID:{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">{slug}</code>
        </p>
      </div>

      <ApiKeySection
        keys={keys}
        selectedKeyId={selectedKeyId}
        setSelectedKeyId={setSelectedKeyId}
        newKeySecret={newKeySecret}
        clearNewKey={clearNewKey}
        isCreatingKey={isCreatingKey}
        onCreateKey={onCreateKey}
      />

      {view === "microcontroller" && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Install the library
          </Label>
          <CodeBlock
            code={`git clone https://github.com/plexus-oss/plexus-c`}
            language="bash"
          />
          <p className="text-[11px] text-muted-foreground">
            Use as a PlatformIO dependency, ESP-IDF component, or copy{" "}
            <code className="font-mono">src/</code> +{" "}
            <code className="font-mono">hal/</code> into your project. Works on
            ESP32, ESP8266, and STM32 (FreeRTOS + LwIP). See the repo README for
            your platform.
          </p>
        </div>
      )}

      {view === "python" && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Install</Label>
          <CodeBlock code="pipx install plexus-python" language="bash" />
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">
          {view === "microcontroller" ? "Sketch" : "Run this"}
        </Label>
        <CodeBlock code={snippet.code} language={snippet.lang} />
        <p className="text-xs text-muted-foreground">{snippet.copy}</p>
      </div>

      <DetailsSection />

      <Button onClick={onDone} disabled={isCreating} className="w-full">
        {isCreating ? "Creating..." : "Done"}
      </Button>
    </div>
  );
}

function DetailsSection() {
  const rate = "1,000 req/sec (org-wide)";
  const retentionYears = Math.round(RETENTION.rawTelemetryDays / 365);
  const rows: { label: string; value: string }[] = [
    { label: "Endpoint", value: "gateway.plexus.company/ingest" },
    { label: "Auth", value: "x-api-key header" },
    { label: "Rate limit", value: rate },
    {
      label: "Recording",
      value: "On by default — toggle on the device page",
    },
    {
      label: "Retention",
      value: `${retentionYears} years raw · 5 years hourly rollups`,
    },
    { label: "Timestamps", value: "UTC — auto-stamped if omitted" },
    { label: "Payload", value: "JSON · source_id + points[]" },
  ];
  return (
    <div className="space-y-1.5 min-w-0">
      <div className="rounded-lg border border-border/60 bg-muted/20 divide-y divide-border/60 min-w-0">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between gap-3 px-3 py-2 text-[12px] min-w-0"
          >
            <span className="text-muted-foreground shrink-0">{r.label}</span>
            <span className="font-mono text-foreground/90 text-right break-all">
              {r.value}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground px-1">
        The Record switch on the device page controls whether points persist to
        storage. When off, points still stream live but aren&apos;t saved.
      </p>
    </div>
  );
}

function ApiKeySection({
  keys,
  selectedKeyId,
  setSelectedKeyId,
  newKeySecret,
  clearNewKey,
  isCreatingKey,
  onCreateKey,
}: {
  keys: ApiKey[];
  selectedKeyId: string | null;
  setSelectedKeyId: (v: string | null) => void;
  newKeySecret: string | null;
  clearNewKey: () => void;
  isCreatingKey: boolean;
  onCreateKey: () => void;
}) {
  const activeKeys = keys.filter((k) => k.active);

  if (newKeySecret) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 space-y-2">
        <p className="text-xs font-medium flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-green-600" />
          API key created — save it, it won&apos;t be shown again.
        </p>
        <CodeBlock code={newKeySecret} language="text" />
        <button
          onClick={clearNewKey}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Use a different key
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">API key</Label>
      <div className="flex gap-2">
        <Select
          value={selectedKeyId ?? ""}
          onValueChange={(v) => setSelectedKeyId(v || null)}
          disabled={activeKeys.length === 0}
        >
          <SelectTrigger className="flex-1">
            <SelectValue
              placeholder={
                activeKeys.length === 0
                  ? "No keys yet — create one"
                  : "Select an API key"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {activeKeys.map((k) => (
              <SelectItem key={k.id} value={k.id}>
                <span className="flex items-center gap-2">
                  <Key className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{k.name}</span>
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {k.keyPrefix}...
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={onCreateKey}
          disabled={isCreatingKey}
          className="shrink-0"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          {isCreatingKey ? "Creating..." : "New key"}
        </Button>
      </div>
      {selectedKeyId && (
        <p className="text-xs text-muted-foreground px-1">
          You&apos;ll need the full plaintext key — if you don&apos;t have it
          saved, create a new one.
        </p>
      )}
    </div>
  );
}

// ═══ Empty device ════════════════════════════════════════════════════════════

function EmptyFlow({
  name,
  setName,
  slug,
  isCreating,
  onCreate,
}: {
  name: string;
  setName: (v: string) => void;
  slug: string;
  isCreating: boolean;
  onCreate: () => void;
}) {
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      name.trim(),
    );

  return (
    <div className="space-y-5 min-w-0">
      <p className="text-xs text-muted-foreground">
        Creates a device with no ingest or link configured. The identifier you
        choose is the value we&apos;ll match on later — use a UUID or external
        ID if this device already exists in another system.
      </p>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Name or UUID</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. drone-042 or 7b2a-4f9c-..."
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          {looksLikeUuid ? (
            <>Looks like a UUID — stored as-is.</>
          ) : (
            <>
              Stored as ID:{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                {slug}
              </code>
            </>
          )}
        </p>
      </div>

      <Button
        onClick={onCreate}
        disabled={isCreating || !name.trim()}
        className="w-full"
      >
        {isCreating ? "Creating..." : "Create device"}
      </Button>
    </div>
  );
}

// ═══ Satellite flow ══════════════════════════════════════════════════════════

function SatelliteFlow(props: {
  initial: TleLookupResult | null;
  initialQuery: string;
  result: TleLookupResult | null;
  setResult: (v: TleLookupResult | null) => void;
  color: string;
  setColor: (v: string) => void;
  groupName: string;
  setGroupName: (v: string) => void;
  nameOverride: string;
  setNameOverride: (v: string) => void;
  isAdding: boolean;
  onAdd: () => void;
}) {
  const {
    initialQuery,
    result,
    setResult,
    groupName,
    setGroupName,
    isAdding,
    onAdd,
  } = props;
  const [query, setQuery] = useState(
    result ? String(result.norad_id) : initialQuery,
  );
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLookup = async () => {
    if (!query.trim()) return;
    setLooking(true);
    setError(null);
    setResult(null);
    try {
      const isNumeric = /^\d+$/.test(query.trim());
      const r = await lookupTle(
        isNumeric
          ? { norad_id: parseInt(query.trim(), 10) }
          : { name: query.trim() },
      );
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLooking(false);
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      <div className="space-y-2 min-w-0">
        <Label className="text-xs text-muted-foreground">
          NORAD ID or name
        </Label>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onLookup()}
            placeholder="e.g. 25544 or ISS"
            autoFocus
          />
          <Button
            onClick={onLookup}
            disabled={!query.trim()}
            loading={looking}
            className="px-4"
          >
            Look up
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {result && (
        <div className="space-y-4 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{result.name}</p>
            <p className="text-xs text-muted-foreground">
              NORAD {result.norad_id}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">Inclination</span>
            <span>{result.orbital_params.inclination.toFixed(2)}&deg;</span>
            <span className="text-muted-foreground">Altitude</span>
            <span>{result.orbital_params.altitude.toFixed(0)} km</span>
            <span className="text-muted-foreground">Period</span>
            <span>{result.orbital_params.period.toFixed(1)} min</span>
            <span className="text-muted-foreground">Eccentricity</span>
            <span>{result.orbital_params.eccentricity.toFixed(5)}</span>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Group (optional)
            </Label>
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Constellation A"
            />
          </div>

          <Button onClick={onAdd} loading={isAdding} className="w-full">
            Add satellite
          </Button>
        </div>
      )}
    </div>
  );
}
