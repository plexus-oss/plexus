/**
 * Provider layer for the labeling feature: one entry point that routes to a
 * LOCAL Ollama model or the Anthropic Messages API based on environment.
 *
 * Selection (checked per call, never cached):
 * - OLLAMA_URL explicitly set        → Ollama (existing ollama.ts client)
 * - no OLLAMA_URL, ANTHROPIC_API_KEY → Anthropic (raw fetch, tool-forced JSON)
 * - neither                          → OllamaUnavailableError → route 503s
 *
 * LOCAL-FIRST INVARIANT: when OLLAMA_URL is set we NEVER fall back to
 * Anthropic on failure — a self-hoster pointing at a local model must never
 * have telemetry silently sent to a cloud API. Ollama failure → 503, full
 * stop.
 */
import "server-only";

import { ollamaChatJson, OllamaUnavailableError } from "@/lib/ai/label/ollama";

/** Tool the Anthropic call forces; its input IS the label response schema. */
export const LABEL_TOOL_NAME = "report_observations";

/** Same model as the column annotator; override with LABEL_MODEL. */
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

export type LabelProvider = "ollama" | "anthropic";

export interface RunLabelModelArgs {
  system: string;
  prompt: string;
  /** JSON schema the model's reply must conform to. */
  schema: Record<string, unknown>;
}

export interface LabelModelReply {
  result: unknown;
  model: string;
  provider: LabelProvider;
  /** Anthropic always reports usage; Ollama only when the server does. */
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Which provider a labeling request would use right now — a cheap env check
 * only (no network probe). OLLAMA_URL must be EXPLICITLY set to select
 * Ollama; the ollama.ts localhost default never routes here.
 */
export function resolveLabelProvider(): LabelProvider | null {
  if (process.env.OLLAMA_URL) return "ollama";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

/** Run the labeling model on whichever provider the environment selects. */
export async function runLabelModel(
  args: RunLabelModelArgs,
): Promise<LabelModelReply> {
  const provider = resolveLabelProvider();
  if (provider === "ollama") return runOllama(args);
  if (provider === "anthropic") return runAnthropic(args);
  throw new OllamaUnavailableError("No labeling provider configured");
}

async function runOllama(args: RunLabelModelArgs): Promise<LabelModelReply> {
  // Any failure here propagates as-is (OllamaUnavailableError → 503) — no
  // Anthropic fallback, per the local-first invariant above.
  const reply = await ollamaChatJson<unknown>({
    system: args.system,
    user: args.prompt,
    schema: args.schema,
  });
  return {
    result: reply.result,
    model: reply.model,
    provider: "ollama",
    // Informational only — Ollama usage is never billed or recorded.
    usage:
      reply.promptEvalCount != null || reply.evalCount != null
        ? {
            input_tokens: reply.promptEvalCount ?? 0,
            output_tokens: reply.evalCount ?? 0,
          }
        : undefined,
  };
}

/**
 * Raw fetch to the Anthropic Messages API — same headers/version/error
 * pattern as lib/ai/column-annotator.ts. Schema conformance comes from a
 * single forced tool whose input_schema IS the label response schema; the
 * tool_use block's input is the result.
 */
async function runAnthropic(args: RunLabelModelArgs): Promise<LabelModelReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY as string;
  const model = process.env.LABEL_MODEL || DEFAULT_ANTHROPIC_MODEL;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0,
      system: args.system,
      messages: [{ role: "user", content: args.prompt }],
      tools: [
        {
          name: LABEL_TOOL_NAME,
          description:
            "Report the observations (and optional remember items) found in the telemetry window.",
          input_schema: args.schema,
        },
      ],
      tool_choice: { type: "tool", name: LABEL_TOOL_NAME },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[assistant-label] Anthropic API error:", response.status, errorText);
    throw new Error(`Anthropic responded ${response.status}`);
  }

  const data = (await response.json()) as {
    model?: string;
    content?: Array<{ type?: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const toolUse = Array.isArray(data.content)
    ? data.content.find(
        (b) => b?.type === "tool_use" && b?.name === LABEL_TOOL_NAME,
      )
    : undefined;
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) {
    throw new Error("Anthropic returned no tool_use input");
  }

  return {
    result: toolUse.input,
    model: data.model || model,
    provider: "anthropic",
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    },
  };
}
