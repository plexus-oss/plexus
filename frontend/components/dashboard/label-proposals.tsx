"use client";

/**
 * "Label" action for chart panels: sends the visible window's series to the
 * configured labeling model (local Ollama, or Anthropic when no OLLAMA_URL is
 * set) and renders its observations as proposal cards. The button renders
 * only when a provider is available (GET /api/assistant/label). The
 * model never mutates anything — the user Applies (→ annotation via the
 * existing annotations path, so the chart overlay updates live) or Dismisses
 * each proposal, and every verdict is logged server-side. The model may also
 * propose "remember" memories; applying one saves it as a text context item
 * on the panel's primary source via the existing source-context API.
 */

import { useCallback, useState } from "react";
import { Sparkles, Check, X, BookmarkPlus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAnnotations } from "@/hooks/use-annotations";
import { useLabelAvailability } from "@/hooks/use-label-availability";
import { useUserSettings } from "@/context/user-settings-context";
import { formatTimeInZone } from "@/lib/timezone";
import { toast } from "@/lib/toast-utils";
import { cn } from "@/lib/utils";
import type { LabelObservation, RememberProposal } from "@/lib/ai/label/prompt";

interface LabelProposalsProps {
  /** Qualified "slug:metric" keys, exactly what the chart queries with. */
  metrics: string[];
  /** Currently rendered window, epoch ms. */
  timeWindow: { start: number; end: number };
  /** Source the applied annotations attach to (same id the panel annotates). */
  sourceId: string;
}

interface Proposal extends LabelObservation {
  id: number;
}

interface Memory extends RememberProposal {
  id: number;
}

export function LabelProposals({ metrics, timeWindow, sourceId }: LabelProposalsProps) {
  const { settings } = useUserSettings();
  const { available, provider } = useLabelAvailability();
  const { createAnnotation } = useAnnotations({ sourceId });
  const [loading, setLoading] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [applyingMemoryId, setApplyingMemoryId] = useState<number | null>(null);
  // Persisted run this batch of proposals came from. Proposal ids double as
  // observation indices in the run row (labels first); memories follow at
  // observationCount + id. Threaded into verdicts so /intelligence can show
  // the human decision next to what the model proposed.
  const [runId, setRunId] = useState<string | null>(null);
  const [observationCount, setObservationCount] = useState(0);

  const sendVerdict = useCallback(
    (p: Proposal, applied: boolean) => {
      void fetch("/api/assistant/label/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "label",
          label: p.label,
          start_ms: p.start_ms,
          end_ms: p.end_ms,
          applied,
          ...(runId ? { run_id: runId, observation_index: p.id } : {}),
        }),
      }).catch(() => {});
    },
    [runId],
  );

  const sendMemoryVerdict = useCallback(
    (m: Memory, applied: boolean) => {
      void fetch("/api/assistant/label/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "remember",
          label: m.content,
          applied,
          ...(runId
            ? { run_id: runId, observation_index: observationCount + m.id }
            : {}),
        }),
      }).catch(() => {});
    },
    [runId, observationCount],
  );

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/assistant/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metrics,
          start: Math.floor(timeWindow.start),
          end: Math.ceil(timeWindow.end),
        }),
      });
      if (res.status === 503) {
        toast.info("Local model isn't running", {
          description: 'Start Ollama with "ollama serve" to label this chart.',
        });
        return;
      }
      if (!res.ok) throw new Error(`Labeling failed (${res.status})`);
      const data = (await res.json()) as {
        observations: LabelObservation[];
        remember?: RememberProposal[];
        run_id?: string;
      };
      const remember = data.remember ?? [];
      setRunId(data.run_id ?? null);
      setObservationCount(data.observations.length);
      if (data.observations.length === 0 && remember.length === 0) {
        toast.info("No notable features found in this window");
        return;
      }
      setProposals(
        data.observations.length > 0
          ? data.observations.map((o, i) => ({ ...o, id: i }))
          : null,
      );
      setMemories(
        remember.length > 0 ? remember.map((m, i) => ({ ...m, id: i })) : null,
      );
    } catch {
      toast.error("Labeling failed");
    } finally {
      setLoading(false);
    }
  }, [metrics, timeWindow.start, timeWindow.end]);

  const remove = useCallback((id: number) => {
    setProposals((prev) => {
      const next = (prev ?? []).filter((p) => p.id !== id);
      return next.length > 0 ? next : null;
    });
  }, []);

  const removeMemory = useCallback((id: number) => {
    setMemories((prev) => {
      const next = (prev ?? []).filter((m) => m.id !== id);
      return next.length > 0 ? next : null;
    });
  }, []);

  const handleApply = useCallback(
    async (p: Proposal) => {
      setApplyingId(p.id);
      try {
        await createAnnotation({
          source_id: sourceId,
          timestamp_start: new Date(p.start_ms).toISOString(),
          timestamp_end:
            p.end_ms != null ? new Date(p.end_ms).toISOString() : null,
          label: p.label,
          color: "purple",
          notes: p.note,
        });
        sendVerdict(p, true);
        remove(p.id);
      } catch {
        toast.error("Failed to save annotation");
      } finally {
        setApplyingId(null);
      }
    },
    [createAnnotation, sourceId, sendVerdict, remove],
  );

  const handleDismiss = useCallback(
    (p: Proposal) => {
      sendVerdict(p, false);
      remove(p.id);
    },
    [sendVerdict, remove],
  );

  // Apply a memory by creating a text context item through the existing
  // source-context API — same request shape context-tab.tsx uses for notes.
  const handleRemember = useCallback(
    async (m: Memory) => {
      setApplyingMemoryId(m.id);
      try {
        const res = await fetch(`/api/sources/${sourceId}/context`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context_type: "note",
            name: "Model memory",
            content: m.content,
          }),
        });
        if (!res.ok) throw new Error(`Saving memory failed (${res.status})`);
        sendMemoryVerdict(m, true);
        removeMemory(m.id);
      } catch {
        toast.error("Failed to save memory");
      } finally {
        setApplyingMemoryId(null);
      }
    },
    [sourceId, sendMemoryVerdict, removeMemory],
  );

  const handleDismissMemory = useCallback(
    (m: Memory) => {
      sendMemoryVerdict(m, false);
      removeMemory(m.id);
    },
    [sendMemoryVerdict, removeMemory],
  );

  const fmtRange = (p: Proposal): string => {
    const start = formatTimeInZone(
      new Date(p.start_ms),
      settings.timezone,
      settings.use12HourFormat,
    );
    if (p.end_ms == null) return start;
    return `${start} – ${formatTimeInZone(
      new Date(p.end_ms),
      settings.timezone,
      settings.use12HourFormat,
    )}`;
  };

  const open = proposals !== null || memories !== null;

  // No provider configured (no local Ollama, no Anthropic key) — no button.
  // The POST route's 503 toast remains the runtime fallback if availability
  // changes between render and click.
  if (!available) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setProposals(null);
          setMemories(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          onClick={run}
          disabled={loading}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors",
            open
              ? "text-foreground bg-muted"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            loading && "pointer-events-none",
          )}
          title={
            provider === "anthropic"
              ? "Label with AI"
              : "Label with local model"
          }
        >
          {loading ? (
            <Spinner className="h-3.5 w-3.5 border-[0.12em]" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">Label</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 p-0">
        <div className="px-3 py-2 border-b border-border">
          <p className="text-xs font-medium text-foreground">
            Proposed labels
          </p>
          <p className="text-[11px] text-muted-foreground">
            {provider === "anthropic"
              ? "From the model — apply to annotate the chart"
              : "From your local model — apply to annotate the chart"}
          </p>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <div className="divide-y divide-border">
            {(proposals ?? []).map((p) => (
              <div key={p.id} className="px-3 py-2.5 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium leading-tight">
                    {p.label}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 text-muted-foreground shrink-0"
                  >
                    {p.confidence}
                  </Badge>
                </div>
                {p.note && (
                  <p className="text-xs text-muted-foreground">{p.note}</p>
                )}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="text-[11px] font-mono text-muted-foreground truncate">
                    {fmtRange(p)}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => handleDismiss(p)}
                      disabled={applyingId === p.id}
                    >
                      <X className="h-3 w-3" />
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      loading={applyingId === p.id}
                      onClick={() => handleApply(p)}
                    >
                      {applyingId !== p.id && <Check className="h-3 w-3" />}
                      Apply
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {(memories ?? []).length > 0 && (
            <div className="border-t border-border">
              <div className="px-3 py-2 border-b border-border">
                <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  Remember
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Durable facts — apply to save to this source&apos;s context
                </p>
              </div>
              <div className="divide-y divide-border">
                {(memories ?? []).map((m) => (
                  <div key={m.id} className="px-3 py-2.5 space-y-1">
                    <p className="text-sm leading-tight">{m.content}</p>
                    <div className="flex items-center justify-end gap-1 pt-0.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => handleDismissMemory(m)}
                        disabled={applyingMemoryId === m.id}
                      >
                        <X className="h-3 w-3" />
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        loading={applyingMemoryId === m.id}
                        onClick={() => handleRemember(m)}
                      >
                        {applyingMemoryId !== m.id && (
                          <Check className="h-3 w-3" />
                        )}
                        Apply
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
