"use client";

/**
 * Template gallery — the dashboard creation dialog.
 *
 *   ┌────────────────────────┬──────────────────────────────────┐
 *   │ ─ Device overview      │  source ▾                        │
 *   │ ─ Service health       │  ───────────────────────────────  │
 *   │ ─ Web analytics        │  static preview (MiniDashboard)  │
 *   │ ─ Satellite ops*       │                                  │
 *   ├────────────────────────┴──────────────────────────────────┤
 *   │ [Start blank instead]        [Cancel]  [Create dashboard] │
 *   └───────────────────────────────────────────────────────────┘
 *
 * Split-pane layout cloned from add-panel-modal. Templates are pure data
 * (lib/dashboards/templates.ts): the preview renders template.build() through
 * the same MiniDashboard the Terminal's dashboard proposals use, and Create
 * posts to /api/dashboards/quick-start — so what you preview is exactly what
 * the route persists. *Satellite ops only appears for space-pack orgs.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MiniDashboard } from "@/components/assistant/mini-dashboard";
import { CodeBlock } from "@/components/connect/code-block";
import { useSources } from "@/hooks/use-sources";
import { useAvailableMetrics } from "@/hooks/use-telemetry";
import { useSpacePack } from "@/hooks/use-space-pack";
import { AGENT_SETUP_LEAD, AGENT_SETUP_PROMPT } from "@/lib/agent-setup";
import {
  DASHBOARD_TEMPLATES,
  defaultTemplateForKind,
} from "@/lib/dashboards/templates";
import { toast } from "@/lib/toast-utils";

/** Sentinel id for the paste-a-prompt path in the left rail. */
const AGENT_SETUP_ID = "agent-setup";

interface TemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  /** Preselect a source (e.g. from a ?quick=<slug> deep-link). */
  initialSourceSlug?: string;
  /** When provided, the footer offers a quiet "Start blank instead" path. */
  onStartBlank?: () => void;
}

export function TemplateGallery({
  open,
  onClose,
  initialSourceSlug,
  onStartBlank,
}: TemplateGalleryProps) {
  const router = useRouter();
  const { devices } = useSources();
  const { metricsBySource } = useAvailableMetrics();
  const spacePack = useSpacePack();

  const [sourceSlug, setSourceSlug] = useState<string>(
    initialSourceSlug ?? "",
  );
  // null = follow the selected source's kind default.
  const [pickedTemplateId, setPickedTemplateId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Reset when the modal transitions to open (render-phase prop-change
  // pattern, same as add-panel-modal — avoids set-state-in-effect cascades).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSourceSlug(initialSourceSlug ?? "");
      setPickedTemplateId(null);
      setIsCreating(false);
    }
  }

  const templates = useMemo(
    () =>
      DASHBOARD_TEMPLATES.filter(
        (t) => spacePack || t.id !== "satellite-ops",
      ),
    [spacePack],
  );

  const selectedSource = useMemo(
    () => devices.find((d) => d.slug === sourceSlug),
    [devices, sourceSlug],
  );

  // Stored metrics for the selected source — metricsBySource is keyed by
  // slug, same derivation the device page uses.
  const sourceMetrics = useMemo(() => {
    if (!sourceSlug) return [];
    const entry = metricsBySource.find((m) => m.source_id === sourceSlug);
    return entry ? [...entry.metrics].sort() : [];
  }, [metricsBySource, sourceSlug]);

  // With nothing connected yet, the templates have nothing to build from —
  // the agent-setup path is the one that gets data flowing, so it's the
  // default view for an empty org.
  const agentMode =
    pickedTemplateId === AGENT_SETUP_ID ||
    (pickedTemplateId === null && devices.length === 0);

  const selectedTemplate = useMemo(() => {
    const picked =
      pickedTemplateId && pickedTemplateId !== AGENT_SETUP_ID
        ? templates.find((t) => t.id === pickedTemplateId)
        : undefined;
    return (
      picked ?? defaultTemplateForKind(selectedSource?.device_type)
    );
  }, [pickedTemplateId, templates, selectedSource]);

  const previewPanels = useMemo(
    () =>
      sourceSlug && sourceMetrics.length > 0
        ? selectedTemplate.build(sourceMetrics, sourceSlug)
        : [],
    [selectedTemplate, sourceMetrics, sourceSlug],
  );

  const canCreate =
    !!sourceSlug && sourceMetrics.length > 0 && !isCreating;

  const handleCreate = async () => {
    if (!canCreate) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/dashboards/quick-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: sourceSlug,
          template: selectedTemplate.id,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        dashboard?: { id: string };
        error?: string;
      };
      if (!res.ok || !body.dashboard) {
        throw new Error(body.error || "Failed to create dashboard");
      }
      onClose();
      router.push(`/dashboards/${body.dashboard.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create dashboard",
      );
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="text-sm font-medium">
            New Dashboard
          </DialogTitle>
        </DialogHeader>

        <div className="flex h-[440px]">
          {/* Left: template list */}
          <aside className="w-60 border-r border-border overflow-y-auto p-1.5">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium px-2 pb-1">
              From your code
            </div>
            <button
              type="button"
              onClick={() => setPickedTemplateId(AGENT_SETUP_ID)}
              className={
                "w-full flex flex-col gap-0.5 px-2 py-1.5 rounded transition-colors text-left mb-2 " +
                (agentMode
                  ? "bg-foreground/10 text-foreground"
                  : "hover:bg-muted/60 text-muted-foreground hover:text-foreground")
              }
            >
              <span className="text-[11px] font-medium">
                Set up with your coding agent
              </span>
              <span className="text-[10px] text-muted-foreground">
                Paste one prompt — it instruments your app and the dashboard
                builds itself
              </span>
            </button>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium px-2 pb-1">
              Templates
            </div>
            <div className="space-y-0.5">
              {templates.map((t) => {
                const isSelected = !agentMode && selectedTemplate.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPickedTemplateId(t.id)}
                    className={
                      "w-full flex flex-col gap-0.5 px-2 py-1.5 rounded transition-colors text-left " +
                      (isSelected
                        ? "bg-foreground/10 text-foreground"
                        : "hover:bg-muted/60 text-muted-foreground hover:text-foreground")
                    }
                  >
                    <span className="text-[11px] font-medium">{t.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {t.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Right: source picker + static preview (or the agent prompt) */}
          <main className="flex-1 flex flex-col min-w-0">
            {agentMode ? (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {AGENT_SETUP_LEAD}
                </p>
                <CodeBlock code={AGENT_SETUP_PROMPT} language="text" />
              </div>
            ) : (
              <>
            <div className="px-4 py-3 border-b border-border">
              <Select
                value={sourceSlug || undefined}
                onValueChange={setSourceSlug}
              >
                <SelectTrigger className="h-7 text-[11px] w-full">
                  <SelectValue placeholder="Choose a source…" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((d) => (
                    <SelectItem
                      key={d.slug}
                      value={d.slug}
                      className="text-[11px]"
                    >
                      {d.name || d.slug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sourceSlug && sourceMetrics.length === 0 && (
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  No metrics yet on this source
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
              {previewPanels.length > 0 ? (
                <MiniDashboard panels={previewPanels} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-[11px] text-muted-foreground">
                    {devices.length === 0
                      ? "Connect a source to preview a dashboard"
                      : "Choose a source to preview this template"}
                  </p>
                </div>
              )}
            </div>
              </>
            )}
          </main>
        </div>

        <footer className="flex items-center gap-2 px-4 py-3 border-t border-border">
          {onStartBlank && (
            <button
              type="button"
              onClick={onStartBlank}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Start blank instead
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {agentMode ? (
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            ) : (
              <Button size="sm" onClick={handleCreate} disabled={!canCreate}>
                {isCreating ? "Creating…" : "Create dashboard"}
              </Button>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
