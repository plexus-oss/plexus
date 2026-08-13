"use client";

/**
 * A reviewable proposal the Terminal emits (preview → confirm → apply). The
 * agent never mutates; the user clicks Apply, which calls the real authenticated
 * create route. The preview is a MINI version of the real product component the
 * proposal will create — a mini monitor row, a mini dashboard, etc. — so what
 * you review looks like what you'll get. Deep-links to the resource afterward.
 */

import { useState } from "react";
import { mutate } from "swr";
import Link from "next/link";
import {
  Check,
  AlertTriangle,
  ArrowUpRight,
  LayoutDashboard,
  Mail,
  Cpu,
  Pencil,
  Trash2,
  Database,
  Tag,
  BookmarkPlus,
  X,
} from "lucide-react";
import { connectionMeta } from "@/lib/connections/connection-meta";
import { useUserSettings } from "@/context/user-settings-context";
import { formatDateTimeInZone } from "@/lib/timezone";
import { ACCENT } from "@/components/assistant/terminal-theme";
import { InlinePanel } from "@/components/assistant/inline-panel";
import { MiniDashboard } from "@/components/assistant/mini-dashboard";
import { MiniMonitor } from "@/components/assistant/mini-monitor";
import { cn } from "@/lib/utils";
import type { Panel } from "@/lib/types/dashboard";
import type { Severity } from "@/lib/triage/types";

// Revalidate the relevant list so the new object shows immediately, even though
// the Terminal created it out-of-band (mirrors the product's onCreated→mutate).
// Annotation/memory lists key by parameterized URLs, so those refresh via a
// key-prefix filter in `apply` instead.
const LIST_KEY: Record<
  Exclude<Proposal["kind"], "annotation" | "memory">,
  string
> = {
  monitor: "/api/monitors",
  dashboard: "/api/dashboards",
  integration: "/api/integrations/email",
  source: "/api/sources",
  connection: "/api/sources",
};

export interface Proposal {
  kind:
    | "monitor"
    | "dashboard"
    | "integration"
    | "source"
    | "connection"
    | "annotation"
    | "memory";
  /** What Apply does — drives the HTTP method + success copy. Default "create". */
  action?: "create" | "update" | "delete";
  title: string;
  summary: string;
  endpoint: string;
  body: unknown;
  /** For a connection create — the type, so we render the right input placeholder. */
  connectionType?: string;
  previewMetrics?: string[];
  /** For a dashboard — the exact Panel[] Apply will create (mini-dashboard preview). */
  previewPanels?: Panel[];
  appliedHref?: string;
  /** For annotation/memory — the ai_label_runs row this proposal was persisted
   *  as; Apply/Dismiss stamps the human verdict onto it via the existing
   *  /api/assistant/label/verdict route (read by /intelligence). */
  verdict?: {
    runId: string;
    index: number;
    kind: "label" | "remember";
    label: string;
    startMs?: number | null;
    endMs?: number | null;
  };
}

type State = "idle" | "applying" | "done" | "error" | "dismissed";

/** Minimal Panel so InlinePanel can render a live chart for `source:metric`. */
function previewPanel(key: string): Panel {
  return {
    id: `prev-${key}`,
    type: "line",
    title: key.split(":").slice(1).join(":") || key,
    metrics: [key],
    sources: [key.split(":")[0]],
    dataSource: { type: "realtime" },
    config: { aggregation: "last", showLegend: false },
    layout: { x: 0, y: 0, w: 24, h: 6 },
  } as Panel;
}

const PILL = "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium";

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The mini product component the proposal will create — review what you'll get. */
function ProposalPreview({
  proposal,
  connString,
  setConnString,
  disabled,
}: {
  proposal: Proposal;
  connString: string;
  setConnString: (v: string) => void;
  disabled: boolean;
}) {
  const { settings } = useUserSettings();
  const body = (proposal.body ?? {}) as Record<string, unknown>;
  const previews = (proposal.previewMetrics ?? []).slice(0, 4);
  const action = proposal.action ?? "create";

  // ── Annotation: the label + note + window it will draw on the chart ──────
  if (proposal.kind === "annotation") {
    const fmt = (iso: string) =>
      formatDateTimeInZone(
        new Date(iso),
        settings.timezone,
        settings.use12HourFormat,
      );
    const start = String(body.timestamp_start ?? "");
    const end = body.timestamp_end ? String(body.timestamp_end) : null;
    const metric = (proposal.previewMetrics ?? [])[0];
    return (
      <div className="flex items-start gap-3 px-3.5 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
          <Tag className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="truncate text-sm font-medium text-foreground">
            {String(body.label ?? "")}
          </div>
          {Boolean(body.notes) && (
            <div className="text-xs text-muted-foreground">
              {String(body.notes)}
            </div>
          )}
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {metric ? `${metric} · ` : ""}
            {fmt(start)}
            {end ? ` – ${fmt(end)}` : ""}
          </div>
        </div>
      </div>
    );
  }

  // ── Memory: the durable fact Apply saves to the source's context ─────────
  if (proposal.kind === "memory") {
    return (
      <div className="flex items-start gap-3 px-3.5 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
          <BookmarkPlus className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm leading-snug text-foreground">
            {String(body.content ?? "")}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Saved to the source&apos;s context as &quot;Model memory&quot;.
          </p>
        </div>
      </div>
    );
  }

  // ── Delete: a destructive confirmation row (any source/connection) ───────
  if (action === "delete") {
    const slug = String(body.slug ?? proposal.title.replace(/^Delete · /, ""));
    return (
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-red-500/10">
          <Trash2 className="h-4 w-4 text-red-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{slug}</div>
          <div className="text-xs text-red-500/90">{proposal.summary}</div>
        </div>
      </div>
    );
  }

  // ── Monitor: the real monitor row + the metric chart with the proposed
  //    threshold drawn on it (offline monitors show a freshness statement). ──
  if (proposal.kind === "monitor") {
    const sourceId = String(body.source_id ?? "");
    const offline = body.offline as
      | { timeout_seconds?: number; severity?: string }
      | undefined;
    const threshold = body.threshold as
      | { min?: number | null; max?: number | null; severity?: string }
      | undefined;
    const sev = String(
      (offline ? offline.severity : threshold?.severity) ?? "warning",
    ) as Severity;

    return (
      <div className="px-3.5 py-3">
        <MiniMonitor
          sourceId={sourceId}
          severity={sev}
          metric={body.metric ? String(body.metric) : undefined}
          min={threshold?.min}
          max={threshold?.max}
          offlineMinutes={
            offline
              ? Math.round((offline.timeout_seconds ?? 300) / 60)
              : undefined
          }
        />
      </div>
    );
  }

  // ── Dashboard: a real mini-dashboard — the exact panels Apply will create. ─
  if (proposal.kind === "dashboard") {
    const name = String(body.name ?? proposal.title.replace(/^Dashboard · /, ""));
    const panels = proposal.previewPanels ?? [];
    return (
      <div className="px-3.5 py-3">
        {panels.length > 0 ? (
          <MiniDashboard panels={panels} name={name} />
        ) : (
          // Fallback (older proposals without panels): header + live tiles.
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                <LayoutDashboard className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {proposal.summary}
                </div>
              </div>
            </div>
            {previews.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {previews.map((k) => (
                  <InlinePanel key={k} panel={previewPanel(k)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Email integration: address + event badges ───────────────────────────
  if (proposal.kind === "integration") {
    const email = String(body.emailAddress ?? "");
    const events = Array.isArray(body.events) ? (body.events as string[]) : [];
    return (
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
          <Mail className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{email}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {events.map((e) => (
              <span key={e} className={cn(PILL, "bg-muted text-muted-foreground")}>
                {e.replace("alert.", "").replace("device.", "")}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Connection: a mini connection row; create collects the conn string ───
  if (proposal.kind === "connection") {
    const slug = String(body.slug ?? "");
    const meta = connectionMeta(proposal.connectionType ?? "");
    return (
      <div className="space-y-2.5 px-3.5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
            <Database className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{slug}</div>
            <div className="text-xs text-muted-foreground">{proposal.summary}</div>
          </div>
          {meta && (
            <span className={cn(PILL, "bg-muted text-muted-foreground")}>{meta.label}</span>
          )}
        </div>
        {action === "create" && (
          <div className="space-y-1">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={connString}
              disabled={disabled}
              onChange={(e) => setConnString(e.target.value)}
              placeholder={meta?.placeholder ?? "connection string"}
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-foreground/25 disabled:opacity-60"
            />
            <p className="text-[11px] text-muted-foreground/70">
              Entered here only — never sent to the assistant.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Source: a mini device row (icon + slug + type) ───────────────────────
  const slug = String(body.slug ?? "");
  const isUpdate = action === "update";
  const deviceType = body.device_type ? String(body.device_type) : null;
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
        {isUpdate ? (
          <Pencil className="h-4 w-4 text-primary" />
        ) : (
          <Cpu className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{slug}</div>
        <div className="text-xs text-muted-foreground">{proposal.summary}</div>
      </div>
      {deviceType && (
        <span className={cn(PILL, "bg-muted text-muted-foreground")}>{deviceType}</span>
      )}
    </div>
  );
}

const NOUN: Record<Proposal["kind"], string> = {
  dashboard: "dashboard",
  integration: "email alerts",
  source: "source",
  connection: "connection",
  monitor: "alert",
  annotation: "annotation",
  memory: "memory",
};
const OPEN_LABEL: Record<Proposal["kind"], string> = {
  dashboard: "Open dashboard",
  integration: "View integrations",
  source: "Open device",
  connection: "Open connections",
  monitor: "View alerts",
  annotation: "View annotations",
  memory: "View context",
};

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const action = proposal.action ?? "create";
  const [state, setState] = useState<State>("idle");
  const [href, setHref] = useState<string | undefined>(
    action === "delete" ? undefined : proposal.appliedHref,
  );
  const [note, setNote] = useState<string | null>(null);
  // Connection-create collects the connection string here — it never leaves the
  // browser via the assistant; Apply posts it straight to /api/sources.
  const [connString, setConnString] = useState("");
  const isConnCreate = proposal.kind === "connection" && action === "create";

  const method = action === "delete" ? "DELETE" : action === "update" ? "PATCH" : "POST";

  // Annotation/memory proposals carry their ai_label_runs linkage — stamp the
  // human verdict exactly the way the chart labeling flow does (best-effort).
  const sendVerdict = (applied: boolean) => {
    const v = proposal.verdict;
    if (!v) return;
    void fetch("/api/assistant/label/verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: v.kind,
        label: v.label,
        ...(v.kind === "label"
          ? { start_ms: v.startMs ?? null, end_ms: v.endMs ?? null }
          : {}),
        applied,
        run_id: v.runId,
        observation_index: v.index,
      }),
    }).catch(() => {});
  };

  const dismiss = () => {
    sendVerdict(false);
    setState("dismissed");
  };

  const apply = async () => {
    setState("applying");
    setNote(null);
    try {
      const init: RequestInit = { method };
      if (method !== "DELETE") {
        const payload = isConnCreate
          ? { ...(proposal.body as Record<string, unknown>), connectionString: connString.trim() }
          : proposal.body;
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(payload);
      }
      const res = await fetch(proposal.endpoint, init);
      if (!res.ok) {
        setState("error");
        return;
      }
      try {
        const data = await res.json();
        if (proposal.kind === "dashboard" && data?.dashboard?.id) {
          setHref(`/dashboards/${data.dashboard.id}`);
        }
        // A connection record is created even if its first test fails — surface
        // that so "Created" isn't mistaken for "Connected".
        if (isConnCreate && data?.source?.status === "error") {
          setNote(data.source.last_error || "Created, but couldn't connect — check the credentials.");
        }
      } catch {
        /* keep fallback href */
      }
      setState("done");
      sendVerdict(true);
      // Refresh the relevant list so it shows up now. Annotation and context
      // lists key by parameterized URLs, so match on the key prefix — this is
      // what makes the chart overlay update live after Apply.
      if (proposal.kind === "annotation") {
        void mutate(
          (key) => typeof key === "string" && key.startsWith("/api/annotations"),
        );
      } else if (proposal.kind === "memory") {
        void mutate(
          (key) => typeof key === "string" && key.startsWith(proposal.endpoint),
        );
      } else {
        void mutate(LIST_KEY[proposal.kind]);
      }
    } catch {
      setState("error");
    }
  };

  const noun = NOUN[proposal.kind];
  const doneVerb = action === "delete" ? "deleted" : action === "update" ? "updated" : "created";
  const idleHeader =
    action === "delete"
      ? `proposed ${noun} deletion`
      : action === "update"
        ? `proposed ${noun} update`
        : `proposed ${noun}`;
  const isDelete = action === "delete";

  const applyDisabled =
    state === "applying" || (isConnCreate && connString.trim().length === 0);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background:
              state === "done" || state === "dismissed"
                ? undefined
                : isDelete
                  ? "#ef4444"
                  : ACCENT,
          }}
        />
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {state === "done"
            ? `${doneVerb} ${noun}`
            : state === "dismissed"
              ? `dismissed ${noun}`
              : idleHeader}
        </span>
      </div>

      <ProposalPreview
        proposal={proposal}
        connString={connString}
        setConnString={setConnString}
        disabled={state !== "idle"}
      />

      <div className="flex items-center gap-3 border-t border-border px-3.5 py-2">
        {state === "done" ? (
          <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-foreground">
            <Check className="h-3.5 w-3.5 text-emerald-500" /> {cap(doneVerb)}
            {href && (
              <>
                <span className="text-muted-foreground">·</span>
                <Link
                  href={href}
                  className="inline-flex items-center gap-0.5 font-medium underline-offset-2 hover:underline"
                  style={{ color: ACCENT }}
                >
                  {OPEN_LABEL[proposal.kind]}
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </>
            )}
            {note && (
              <span className="flex items-center gap-1 text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" /> {note}
              </span>
            )}
          </span>
        ) : state === "dismissed" ? (
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <X className="h-3.5 w-3.5" /> Dismissed
          </span>
        ) : state === "error" ? (
          <>
            <span className="flex items-center gap-1.5 text-[13px] text-red-500">
              <AlertTriangle className="h-3.5 w-3.5" /> Couldn&apos;t {action} it.
            </span>
            <button
              onClick={apply}
              className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <button
              onClick={apply}
              disabled={applyDisabled}
              className={cn(
                "rounded-md px-3 py-1 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60",
                isDelete && "bg-red-500",
              )}
              style={isDelete ? undefined : { background: ACCENT }}
            >
              {state === "applying"
                ? isDelete
                  ? "Deleting…"
                  : "Applying…"
                : isDelete
                  ? "Delete"
                  : "Apply"}
            </button>
            {proposal.verdict && (
              <button
                onClick={dismiss}
                disabled={state === "applying"}
                className="text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                Dismiss
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
