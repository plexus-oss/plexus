/**
 * Signal triage types — the core of "monitoring whose default is silence."
 *
 * A raw stream of alerts comes in (mostly noise). The system autonomously
 * decides what is real and absorbs the rest, surfacing only genuine signals.
 * Client-safe; the sample stream is deterministic so the value is visible
 * without a backend.
 */

export type Severity = "critical" | "warning" | "info";

export type NoiseReason =
  | "correlated"
  | "downstream"
  | "flapping"
  | "transient"
  | "maintenance"
  | "benign";

export interface RawAlert {
  id: string;
  ts: string;
  source: string;
  metric: string;
  message: string;
  severity: Severity;
  /** Why this alert is absorbed rather than surfaced. */
  noiseReason: NoiseReason;
  /** Correlated alerts share the id of the signal they roll up into. */
  groupKey?: string;
}

/** One metric panel — a number + its sparkline, built on demand. */
export interface MetricSeries {
  label: string;
  unit?: string;
  /** Latest value. */
  current: number;
  /** Comparable value one window ago, for the delta + faint baseline line. */
  baseline?: number;
  /** Current-window samples. */
  data: number[];
  /** Prior-window samples, drawn faint behind `data`. */
  prior?: number[];
  /** If false, a drop is the bad direction (e.g. coolant flow). Default true. */
  higherIsWorse?: boolean;
  /** Threshold the metric breached, drawn as a reference line on the hero chart. */
  threshold?: number;
  /** One-line story under the hero chart — the causal link, in plain language. */
  caption?: string;
  /** Position (0–1) of the causal moment on the timeline, e.g. when a PR merged. */
  onsetAt?: number;
  /** Label for that moment, e.g. "PR #4821". */
  onsetLabel?: string;
}

/** One line of a unified diff — the change behind a root cause. */
export interface DiffLine {
  type: "context" | "add" | "del";
  /** Line number in the old file (context + del). */
  old?: number;
  /** Line number in the new file (context + add). */
  new?: number;
  text: string;
}

/** The change that caused the incident, shown as a diff instead of a chart. */
export interface ChangeDiff {
  /** File or config path, e.g. "infra/cooling/cdu-7.yaml". */
  file: string;
  /** Provenance line, e.g. "PR #4821 · merged 13:58 · 4 min before onset". */
  sublabel?: string;
  additions: number;
  deletions: number;
  hunk: DiffLine[];
}

/** Where the autonomous response stands. */
export type SignalStatus =
  | "healing" // Plexus is actively remediating
  | "resolved" // remediated and verified
  | "awaiting_approval" // destructive action proposed, needs a human
  | "watching"; // surfaced, no safe action yet

export type StepState = "done" | "active" | "pending";

export type StepKind =
  | "detect"
  | "absorb"
  | "diagnose"
  | "plan"
  | "execute"
  | "dispatch"
  | "verify"
  | "await"
  | "resolve";

/** One event in the self-heal timeline. */
export interface HealStep {
  time?: string;
  kind: StepKind;
  title: string;
  detail?: string;
  state: StepState;
  /** Who did it — the autonomous system or a human. */
  actor?: "plexus" | "human";
}

export interface SignalSeed {
  id: string;
  title: string;
  summary: string;
  rootCause?: string;
  recommended?: string;
  severity: Severity;
  source: string;
  /** Where autonomous remediation stands. */
  status?: SignalStatus;
  /** One-line outcome — what Plexus did, in plain language. */
  outcome?: string;
  /** The self-heal timeline — detection → diagnosis → action → verification. */
  timeline?: HealStep[];
  /** The metrics behind this signal, rendered as on-demand charts. */
  metrics?: MetricSeries[];
  /** The change that caused it — shown as a diff below the response. */
  diff?: ChangeDiff;
  /** External context for *why* it failed — a deploy, config change, etc. */
  externalContext?: Array<{ kind: string; detail: string }>;
  /** Past times this looked the same — institutional memory. */
  similarPast?: Array<{ when: string; note: string }>;
  /** Short trace of how the co-pilot reached the conclusion. */
  trace?: string[];
  /** Time window for the linked, pre-filtered dashboard, e.g. "13:55–14:20". */
  window?: string;
  /** When it started, e.g. "14:02". */
  onset?: string;
  /** How long it's been going, e.g. "18m". Operationally, recency matters. */
  age?: string;
  /** The one action to take — a verb, surfaced as the primary button. */
  action?: string;
  /** Who owns the affected hardware — surfaced so the operator knows who to loop in. */
  owner?: { team: string; person?: string };
  /** What this is hitting, e.g. "3 training jobs · 18 GPUs". */
  affected?: string;
  /** Cross-links that pull the situation together — the PR, runbook, dashboard, prior incident. */
  links?: ContextLink[];
  /** Position on the timeline, 0–100 (mock). */
  at?: number;
}

/** What a context link points at — drives the icon/logo we render. */
export type LinkKind =
  | "github"
  | "dashboard"
  | "runbook"
  | "incident"
  | "node"
  | "workload";

export interface ContextLink {
  kind: LinkKind;
  label: string;
  sublabel?: string;
  href: string;
  /** Brand key (e.g. "github", "grafana") — renders a real logo over the kind icon. */
  source?: string;
}

export interface Signal extends SignalSeed {
  /** The raw alerts this one real signal absorbed (one root cause). */
  absorbed: RawAlert[];
}

export interface TriageResult {
  totalIn: number;
  surfaced: Signal[];
  absorbedCount: number;
  absorbedByReason: Record<NoiseReason, number>;
}
