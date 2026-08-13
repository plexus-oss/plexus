import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { withAuth } from "@/lib/api/with-auth";
import {
  TERMINAL_TOOLS,
  runTool,
  buildMetricPanel,
  buildMonitorProposal,
  buildOfflineProposal,
  buildEmailProposal,
  buildDashboardProposal,
  dashboardSources,
  buildSourceProposal,
  buildUpdateSourceProposal,
  buildDeleteSourceProposal,
  buildConnectionProposal,
  buildUpdateConnectionProposal,
  buildAnnotationProposal,
  buildRememberProposal,
  type ToolCtx,
  type TerminalProposal,
} from "@/lib/ai/terminal/tools";
import {
  aiLabelRunQueries,
  type LabelRunObservation,
} from "@/lib/db/queries/ai-label-runs";
import { getSourceMetrics } from "@/lib/db/clickhouse";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { buildTerminalSystemPrompt } from "@/lib/ai/terminal/system-prompt";
import { recordAiTokens } from "@/lib/ai/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 8; // tool-use rounds before we stop

interface InMsg {
  role: "user" | "assistant";
  content: string;
}

/**
 * Persist a Terminal-originated annotation/remember proposal as an
 * ai_label_runs row — the same observability record the chart labeling flow
 * writes, read by /intelligence — and attach the run linkage to the proposal
 * so the card's Apply/Dismiss stamps the human verdict onto it (via the
 * existing /api/assistant/label/verdict route). Best-effort: if the insert
 * fails the card still renders, just without verdict tracking.
 */
async function attachLabelRun(
  proposal: TerminalProposal,
  ctx: ToolCtx,
  metrics: string[],
): Promise<void> {
  const isAnnotation = proposal.kind === "annotation";
  const body = proposal.body as Record<string, unknown>;
  const now = new Date().toISOString();
  const startIso = isAnnotation ? String(body.timestamp_start) : now;
  const endIso =
    isAnnotation && body.timestamp_end ? String(body.timestamp_end) : startIso;
  const startMs = isAnnotation ? new Date(startIso).getTime() : null;
  const endMs =
    isAnnotation && body.timestamp_end ? new Date(endIso).getTime() : null;
  const label = isAnnotation ? String(body.label) : String(body.content);
  const observation: LabelRunObservation = {
    label,
    note: isAnnotation ? ((body.notes as string | null) ?? null) : null,
    start_ms: startMs,
    end_ms: endMs,
    confidence: null,
    kind: isAnnotation ? "label" : "remember",
    verdict: null,
    verdict_at: null,
  };
  try {
    const run = await aiLabelRunQueries.insert({
      org_id: ctx.orgId,
      user_id: ctx.userId ?? null,
      provider: "anthropic",
      model: MODEL,
      latency_ms: 0,
      input_tokens: null,
      output_tokens: null,
      // Qualified slug-prefixed keys, same shape as label runs —
      // /intelligence scopes run visibility and names the source off these.
      metrics,
      window_start: startIso,
      window_end: endIso,
      context_items: [],
      observations: [observation],
    });
    proposal.verdict = {
      runId: run.id,
      index: 0,
      kind: observation.kind,
      label: label.slice(0, 200),
      startMs,
      endMs,
    };
  } catch {
    /* best-effort — see above */
  }
}

/**
 * POST /api/assistant/terminal — the Plexus Terminal agent loop.
 *
 * Streams NDJSON events to the client: {type:"text",delta}, {type:"tool",name,status},
 * {type:"done"}, {type:"error",message}. Runs a Claude tool_use loop with
 * org-scoped read + propose tools. The `propose_*` tools stream reviewable
 * {type:"proposal"} cards that the user Applies client-side; the agent itself
 * never mutates anything.
 */
export const POST = withAuth(async (request, { orgId, userId, orgRole }) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "assistant_unavailable" },
      { status: 503 },
    );
  }

  let body: { messages?: InMsg[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  if (incoming.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const ctx: ToolCtx = { orgId, userId, orgRole };
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = incoming.slice(-20).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content ?? "").slice(0, 8000),
  }));

  const encoder = new TextEncoder();
  const body_stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      let aiInTokens = 0;
      let aiOutTokens = 0;
      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const ms = client.messages.stream({
            model: MODEL,
            max_tokens: 1024,
            system: buildTerminalSystemPrompt(),
            tools: TERMINAL_TOOLS,
            messages,
          });
          ms.on("text", (t) => send({ type: "text", delta: t }));
          const final = await ms.finalMessage();
          aiInTokens += final.usage?.input_tokens ?? 0;
          aiOutTokens += final.usage?.output_tokens ?? 0;
          messages.push({ role: "assistant", content: final.content });

          if (final.stop_reason !== "tool_use") break;

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            send({ type: "tool", name: block.name, status: "running" });

            // show_metric is special: it renders a live panel inline (dynamic
            // UI) rather than returning data to the model.
            if (block.name === "show_metric") {
              const inp = (block.input ?? {}) as {
                source?: string;
                metric?: string;
                viz?: string;
              };
              const source = String(inp.source ?? "").trim();
              const metric = String(inp.metric ?? "").trim();
              if (source && metric) {
                const viz = inp.viz === "stat" ? "stat" : "line";
                send({
                  type: "panel",
                  panel: buildMetricPanel(source, metric, viz, block.id),
                });
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Rendered a live ${viz} chart of ${source}:${metric} inline for the user.`,
                });
              } else {
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    error: "source and metric required",
                  }),
                });
              }
              continue;
            }

            // propose_monitor streams a reviewable proposal (preview→confirm);
            // it does not create anything — the user Applies it client-side.
            if (block.name === "propose_monitor") {
              const proposal = buildMonitorProposal(block.input);
              if (proposal) {
                send({ type: "proposal", proposal });
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Proposed the alert and showed it to the user to review and Apply. Briefly confirm what it does.`,
                });
              } else {
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    error: "need source, metric, and at least one of min/max",
                  }),
                });
              }
              continue;
            }

            // propose_email_integration: email notifications bound to alerts.
            if (block.name === "propose_email_integration") {
              const inp = (block.input ?? {}) as {
                email?: string;
                events?: unknown;
              };
              let email = typeof inp.email === "string" ? inp.email.trim() : "";
              // Default to the signed-in user's account email — don't make them type it.
              if (!email) {
                try {
                  const rows = await db
                    .select({ email: users.email })
                    .from(users)
                    .where(eq(users.id, userId))
                    .limit(1);
                  const accountEmail = (
                    rows[0] as { email?: string } | undefined
                  )?.email;
                  if (typeof accountEmail === "string") email = accountEmail;
                } catch {
                  /* fall through — buildEmailProposal will reject if still empty */
                }
              }
              const proposal = buildEmailProposal({
                email,
                events: inp.events,
              });
              if (proposal) {
                send({ type: "proposal", proposal });
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Proposed an email integration and showed it to the user to review and Apply. Briefly confirm what it does.`,
                });
              } else {
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    error: "a valid email is required",
                  }),
                });
              }
              continue;
            }

            // propose_offline_alert: a "stream stopped" alert proposal.
            if (block.name === "propose_offline_alert") {
              const proposal = buildOfflineProposal(block.input);
              if (proposal) {
                send({ type: "proposal", proposal });
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Proposed a stream-stopped alert and showed it to the user to review and Apply. Briefly confirm what it does.`,
                });
              } else {
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({ error: "source is required" }),
                });
              }
              continue;
            }

            // propose_dashboard: fetch each source's metrics so the proposal
            // can preview them, then stream it (preview→confirm; Apply creates
            // it). Multiple sources build one overlay dashboard.
            if (block.name === "propose_dashboard") {
              const sources = dashboardSources(block.input);
              const metricsBySource: Record<string, string[]> = {};
              await Promise.all(
                sources.map(async (s) => {
                  try {
                    metricsBySource[s] = await getSourceMetrics(ctx.orgId, s);
                  } catch {
                    metricsBySource[s] = [];
                  }
                }),
              );
              const proposal = buildDashboardProposal(
                block.input,
                metricsBySource,
              );
              if (proposal) {
                send({ type: "proposal", proposal });
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Proposed the dashboard and showed it to the user to review and Apply. Briefly confirm what it includes.`,
                });
              } else {
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    error: "at least one source is required",
                  }),
                });
              }
              continue;
            }

            // propose_create_source: register a new device source. Like the
            // other propose_* tools, it does NOT create anything — the user
            // Applies it client-side, which POSTs to /api/sources.
            if (block.name === "propose_create_source") {
              const proposal = buildSourceProposal(block.input);
              if (proposal) {
                send({ type: "proposal", proposal });
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Proposed a new source and showed it to the user to review and Apply. Briefly confirm what it creates.`,
                });
              } else {
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    error:
                      "a valid slug is required (lowercase letters, numbers, dots, hyphens, underscores)",
                  }),
                });
              }
              continue;
            }

            // propose_annotation / propose_remember — label-flow proposals
            // originating in the Terminal. Persist the ai_label_runs row FIRST
            // so the streamed card carries run linkage for verdict stamping.
            if (
              block.name === "propose_annotation" ||
              block.name === "propose_remember"
            ) {
              const isAnnotation = block.name === "propose_annotation";
              const proposal = isAnnotation
                ? buildAnnotationProposal(block.input)
                : buildRememberProposal(block.input);
              if (proposal) {
                // Annotations key the run by their real slug:metric; memories
                // have no metric, so key by the source's context — that keeps
                // /intelligence access-scoping (slug-prefixed) intact.
                const src = String(
                  (block.input as { source?: unknown })?.source ?? "",
                ).trim();
                const runMetrics = isAnnotation
                  ? (proposal.previewMetrics ?? [])
                  : [`${src}:context`];
                await attachLabelRun(proposal, ctx, runMetrics);
                send({ type: "proposal", proposal });
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: isAnnotation
                    ? "Proposed the annotation and showed it to the user to review and Apply. Briefly say what the label marks and which data supports it."
                    : "Proposed the memory and showed it to the user to review and Apply. Briefly say why it's worth remembering.",
                });
              } else {
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    error: isAnnotation
                      ? "need source, metric, start_ms (epoch milliseconds), and label"
                      : "need source and content",
                  }),
                });
              }
              continue;
            }

            // The remaining propose_* tools all follow the same shape: build a
            // proposal from the model's input, stream it for the user to Apply,
            // and tell the model it PROPOSED (not performed) the action.
            const PROPOSAL_BUILDERS: Record<
              string,
              {
                build: (
                  input: unknown,
                ) => ReturnType<typeof buildSourceProposal>;
                ok: string;
                err: string;
              }
            > = {
              propose_update_source: {
                build: buildUpdateSourceProposal,
                ok: "Proposed an update to the source and showed it to the user to review and Apply. Briefly confirm what changes.",
                err: "need a slug and at least one field to change (name, description, or device_type)",
              },
              propose_delete_source: {
                build: buildDeleteSourceProposal,
                ok: "Proposed deleting the source and showed the user a destructive confirmation to Apply. Make clear it's permanent.",
                err: "a slug is required",
              },
              propose_create_connection: {
                build: buildConnectionProposal,
                ok: "Proposed a new connection and showed the user a card where they enter the connection string and Apply. Do NOT ask for credentials yourself.",
                err: "need a valid connection_type (postgres, timescaledb, mysql, clickhouse, influxdb, prometheus) and a valid slug",
              },
              propose_update_connection: {
                build: buildUpdateConnectionProposal,
                ok: "Proposed an update to the connection and showed it to the user to review and Apply. Briefly confirm what changes.",
                err: "need a slug and at least one field to change (name or description)",
              },
            };

            const builder = PROPOSAL_BUILDERS[block.name];
            if (builder) {
              const proposal = builder.build(block.input);
              if (proposal) {
                send({ type: "proposal", proposal });
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: builder.ok,
                });
              } else {
                send({ type: "tool", name: block.name, status: "done" });
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: JSON.stringify({ error: builder.err }),
                });
              }
              continue;
            }

            let out: unknown;
            try {
              out = await runTool(block.name, block.input, ctx);
            } catch {
              out = { error: "tool failed" };
            }
            send({ type: "tool", name: block.name, status: "done" });
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(out).slice(0, 12000),
            });
          }
          messages.push({ role: "user", content: results });
        }
        send({ type: "done" });
      } catch {
        send({
          type: "error",
          message: "The Terminal hit an error. Try again.",
        });
      } finally {
        recordAiTokens(ctx.orgId, MODEL, aiInTokens, aiOutTokens);
        controller.close();
      }
    },
  });

  return new Response(body_stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});

/**
 * GET /api/assistant/terminal — availability check for the UI ({available}),
 * mirroring GET /api/assistant/label: env-only, no network probe. The
 * "Explain" button on chart panels renders off this (the POST 503s without
 * ANTHROPIC_API_KEY).
 */
export const GET = withAuth(async () => {
  return NextResponse.json({ available: !!process.env.ANTHROPIC_API_KEY });
});
